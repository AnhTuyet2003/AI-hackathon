import { CaseDetailClient } from "@/components/CaseDetailClient";

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseDetailClient caseId={id} />;
}
