import { mentorScenarios, mentorApplication } from '../lib/mentor-cases';
import { extractDocuments, hashUploadedFile } from '../lib/document-ingest';
import { runIntakePipeline, applyOverride, rerouteCase, resolveCase } from '../lib/pipeline';
import { classifyCareDocuments } from '../lib/care-classifier';
import { careFixtures } from '../evaluation/care/fixtures';
import { decideCareRoute } from '../lib/care-routing';
import { parseMedicalText, medicalText } from '../lib/medical-form';
import { evaluateDocumentQuality } from '../lib/document-quality';
import { extractEntities } from '../lib/mock-ai';
import { signCase, verifyCase } from '../lib/case-signature';
import { POST as processCase } from '../app/api/cases/process/route';
import { POST as extract } from '../app/api/documents/extract/route';
import { POST as override } from '../app/api/cases/override/route';
import { POST as resolve } from '../app/api/cases/resolve/route';
import { resetDocumentForm } from '../lib/document-form';
import { passesDocumentQualityScore } from '../lib/document-quality';
import { passesAutoAssignmentConfidence } from '../lib/pipeline';
import { seedCases } from '../lib/seed';
import type { UnderwritingCase } from '../lib/types';
const upload=(text:string,name='evidence.txt')=>({name,mimeType:'text/plain',dataBase64:Buffer.from(text).toString('base64'),documentSessionId:'test-session'});
const request=(body:unknown)=>new Request('http://localhost/api/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{process.env.AI_UD_LIVE_SERVICES='false';process.env.GEMINI_API_KEY='';global.fetch=jest.fn().mockRejectedValue(new Error('Network forbidden in integration tests'));});

describe('reviewed category contract on extracted text',()=>{
 test.each(careFixtures)('$id preserves the independently reviewed route',f=>{
  const result=decideCareRoute(f.input,classifyCareDocuments(f.input.documents));
  expect({category:result.category,reason:result.reason}).toEqual({category:f.expected.category,reason:f.expected.reason});
 });
});
describe('raw document to final assignment',()=>{
 test.each(mentorScenarios)('$id runs extraction, gates, scoring and matching',async s=>{
  const c=await runIntakePipeline(s.application,{files:[upload(s.text)]});
  expect(c.status).toBe(s.expected);
  expect(global.fetch).not.toHaveBeenCalled();
  if(c.status==='POOL_QUEUE') expect(c.assigneeId).toBeNull();
  else {expect(c.documentQuality?.score).toBeGreaterThanOrEqual(8);expect(c.careDecision?.category).toBeTruthy();expect(c.assigneeId).toBeTruthy();}
  if(s.id==='surgery'){expect(c.complexity?.applicationComplexityScore).toBe(5);expect(c.complexity?.score).toBe(8);expect(c.ner?.specialtiesRequired).toContain('General Surgery');}
  if(s.id==='incomplete'||s.id==='conflict'||s.id==='contradiction'){expect(c.complexity).toBeNull();expect(c.match).toBeNull();}
  if(c.documentQuality) expect(c.documentQuality.scoreBreakdown.reduce((n,r)=>n+r.points,0)).toBeCloseTo(c.documentQuality.score,5);
 });
 test('seeds use identical gate and route outcomes',()=>{
  expect(seedCases.map(c=>c.status)).toEqual(mentorScenarios.map(s=>s.expected));
  expect(seedCases.every(c=>c.intakePolicyVersion)).toBe(true);
 });
 test('incomplete application never reaches matching',async()=>{
  const c=await runIntakePipeline({...mentorApplication,occupation:''});
  expect(c.poolQueueReason).toBe('REQUIRED_FIELDS_FAILED');expect(c.match).toBeNull();expect(c.complexity).toBeNull();
 });
 test('failed evidence cannot be overridden, rerouted or resolved',async()=>{
  const c=await runIntakePipeline(mentorApplication,{files:[upload('')]});
  expect(c.poolQueueReason).toBe('DOCUMENT_UNREADABLE');
  expect(()=>applyOverride(c,'UW-TBECKER','test')).toThrow();
  await expect(rerouteCase(c,'test')).rejects.toThrow();expect(()=>resolveCase(c,'test')).toThrow();
 });
 test('names do not determine extraction, and supplied hash cannot poison cache',async()=>{
  const a=upload(mentorScenarios[0].text);const hash=hashUploadedFile(a);
  const [first]=await extractDocuments([{...a,sourceFileHash:hash}]);
  const [renamed]=await extractDocuments([{...a,name:'claim_record_1.pdf'}]);
  expect(renamed.fields).toEqual(first.fields);
  await expect(extractDocuments([{...upload('different bytes'),sourceFileHash:hash}])).rejects.toThrow('hash');
  const [different]=await extractDocuments([upload('unknown content','clinic.txt')]);expect(different.fields.diagnosis).toBeUndefined();
 });
 test('OCR changes are independent and client OCR cannot authorize assignment',async()=>{
  const a=upload('image placeholder');
  const [x]=await extractDocuments([{...a,ocrText:mentorScenarios[0].text}]);
  const [y]=await extractDocuments([{...a,ocrText:'unreadable summary'}]);expect(y.rawText).not.toBe(x.rawText);
  const response=await processCase(request({...mentorApplication,files:[{...a,ocrText:mentorScenarios[0].text}],documentSessionId:'test-session'}));
  expect((await response.json()).case.poolQueueReason).toBe('UNVERIFIED_EVIDENCE');
 });
 test('negation and generic symptoms do not become confirmed specialties',()=>{
  expect(extractEntities({medicalHistory:'No diabetes. No cancer. No cardiac disease.',disclosures:''}).entities).toEqual([]);
  expect(extractEntities({medicalHistory:'',disclosures:''},{symptoms:'abdominal pain and nausea'}).specialtiesRequired).toEqual([]);
  expect(extractEntities({medicalHistory:'',disclosures:''},{diagnosis:'Acute appendicitis'}).specialtiesRequired).toContain('General Surgery');
 });
 test('missing diagnosis, invalid dates and mismatched identities cannot pass',async()=>{
  const fields=parseMedicalText(mentorScenarios[0].text);
  for(const changed of [{...fields,diagnosis:'Not included',diagnosisCode:'Not provided'},{...fields,serviceStart:'2026-02-30'},{...fields,patientName:'Other patient'}]) {
   const c=await runIntakePipeline(mentorApplication,{files:[upload(medicalText(changed,'Outpatient wellness visit'))]});expect(c.status).toBe('POOL_QUEUE');expect(c.match).toBeNull();
  }
  const c=await runIntakePipeline(mentorApplication,{files:[upload(mentorScenarios[0].text),upload(medicalText({...fields,patientName:'Other patient'},'Outpatient wellness visit'),'other.txt')]});expect(c.poolQueueReason).toBe('CONTRADICTORY_INFORMATION');
 });
 test('low extraction confidence blocks assignment despite high quality',async()=>{
  const e=(await extractDocuments([upload(mentorScenarios[0].text)]))[0];e.fields.extractionConfidence=0.2;
  const c=await runIntakePipeline(mentorApplication,{extractions:[e]});expect(c.documentQuality?.score).toBeGreaterThanOrEqual(8);expect(c.poolQueueReason).toBe('INSUFFICIENT_EVALUATION_CONFIDENCE');expect(c.match).toBeNull();
 });
 test('positive source remains unchanged when another extraction is edited',async()=>{
  const e=(await extractDocuments([upload(mentorScenarios[0].text)]))[0];e.fields.patientName='mutated';
  const fresh=(await extractDocuments([upload(mentorScenarios[0].text)]))[0];expect(fresh.fields.patientName).toBe('Mentor Example');
 });
 test('API extraction and processing produce signed case; forged snapshots are rejected',async()=>{
  const file=upload(mentorScenarios[0].text);
  expect((await extract(request({files:[file]}))).status).toBe(200);
  const response=await processCase(request({...mentorApplication,files:[file],documentSessionId:'test-session',documentQuality:{score:10}}));
  expect(response.status).toBe(200);const c=(await response.json()).case as UnderwritingCase;expect(c.status).toBe('ASSIGNED_STP');expect(()=>verifyCase(c)).not.toThrow();
  const forged={...c,sumAssured:1};expect(()=>verifyCase(forged)).toThrow();
  expect((await override(request({case:forged,underwriterId:'UW-TBECKER'}))).status).toBe(400);
  const closed=await resolve(request({case:c,note:'Workflow verification'}));expect(closed.status).toBe(200);expect((await closed.json()).case.status).toBe('RESOLVED');
  expect((await processCase(request({...mentorApplication,extractions:[{}]}))).status).toBe(400);
  expect((await processCase(request({...mentorApplication,files:[file],documentSessionId:'stale'}))).status).toBe(409);
 });
});

describe('integration boundaries and replacement ownership',()=>{
 test.each([[7.9,false],[8,true],[10,true],[NaN,false]])('quality threshold %s', (score,expected)=>expect(passesDocumentQualityScore(score as number)).toBe(expected));
 test.each([[8,0.2,false],[0.9,0.9,true],[undefined,0.9,false]])('confidence indicators %s / %s',(doc,complex,expected)=>expect(passesAutoAssignmentConfidence(doc as number|undefined,complex as number)).toBe(expected));
 test('replacing files restores document-owned values without deleting manual edits',()=>{
  const previous={...mentorApplication,age:60,occupation:'Manually changed',medicalHistory:'Original note. [DOCUMENT_EVIDENCE_START:old] Surgery [DOCUMENT_EVIDENCE_END:old]',disclosures:'Manual disclosure.',documents:['old.txt']};
  const next=resetDocumentForm(previous,{age:{choice:'doc',from:'35',to:'60',source:'old'},occupation:{choice:'doc',from:'Office worker',to:'Surgeon',source:'old'}});
  expect(next.age).toBe(35);expect(next.occupation).toBe('Manually changed');expect(next.medicalHistory).toBe('Original note.');expect(next.documents).toEqual([]);
 });
 test('positive and negated care cues remain distinct',()=>{
  const negative=classifyCareDocuments([{id:'D1',text:'No inpatient admission. No outpatient visit. No dental treatment.'}]);
  expect(Object.values(negative).every(e=>e.state==='not_supported')).toBe(true);
 });
 test('single impossible billing amount fails with itemized score and exact displayed arithmetic',()=>{
  const fields={...parseMedicalText(mentorScenarios[0].text),insurerPayment:10000};
  const q=evaluateDocumentQuality([{fileName:'x',mimeType:'text/plain',kind:'medical',provider:'stub',fields,rawText:medicalText(fields,'Outpatient wellness visit'),readable:true,warnings:[],summary:''}],'deterministic-fallback','Outpatient');
  expect(q.validationStatus).toBe('FAILED');expect(q.contradictions.some(c=>c.code==='INSURER_PAYMENT_EXCEEDS_ELIGIBLE_AMOUNT')).toBe(true);
  expect(q.baseScore+q.scoreBreakdown.filter(r=>/penalt|cap|adjustment/i.test(r.dimension)).reduce((n,r)=>n+r.points,0)).toBeCloseTo(q.score,5);
 });
 test('absence and partial evidence are shown in different buckets',()=>{
  const fields={...parseMedicalText(mentorScenarios[0].text),policyNumber:'Not available',supportingDocuments:'Not included',billingAmount:undefined};
  const q=evaluateDocumentQuality([{fileName:'x',mimeType:'text/plain',kind:'medical',provider:'stub',fields,rawText:medicalText(fields,'Outpatient wellness visit'),readable:true,warnings:[],summary:''}]);
  expect(q.partialFields).toContain('Patient and policy information');expect(q.missingFields).not.toContain('Patient and policy information');expect(q.missingFields).toContain('Supporting documents and billing consistency');
 });
 test('replacement inputs evaluate independently in both directions',async()=>{
  const good=mentorScenarios[1],bad=mentorScenarios[3];
  for(const s of [good,bad,good]){
   const c=await runIntakePipeline(s.application,{files:[upload(s.text,'same-name.txt')]});expect(c.status).toBe(s.expected);
   if(s.id==='incomplete')expect(c.ner).toBeNull();else expect(c.ner?.specialtiesRequired).toContain('General Surgery');
  }
 });
 test('repeated exact bytes preserve quality, category and complexity',async()=>{
  const run=()=>runIntakePipeline(mentorApplication,{files:[upload(mentorScenarios[0].text)]});const a=await run(),b=await run();
  expect(a.documentQuality).toEqual(b.documentQuality);expect(a.careEvidence).toEqual(b.careEvidence);expect(a.complexity).toEqual(b.complexity);
 });
 test('a form without files creates a required-evidence queue case rather than accepting extraction placeholders',async()=>{
  const response=await processCase(request({...mentorApplication,files:[],extractions:[]}));expect(response.status).toBe(200);expect((await response.json()).case.poolQueueReason).toBe('REQUIRED_FIELDS_FAILED');
 });
});
