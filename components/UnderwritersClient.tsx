"use client";

import { useEffect, useState } from "react";
import {
  RecordHeader,
  FormSection,
  CommandBar,
  CommandButton,
} from "@/components/ModelDriven";
import {
  getUnderwriters,
  saveUnderwriters,
  queueLoadCapByTier,
} from "@/lib/underwriters";
import type { Underwriter } from "@/lib/types";

const CARE_GROUPS = ["Outpatient", "Inpatient", "Dental"] as const;
const TIERS = ["Junior", "Senior", "Medical"] as const;
const AVAILABILITY = ["active", "dnd", "offline"] as const;

function emptyForm(): Partial<Underwriter> {
  return {
    id: `UW-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    tier: "Junior",
    availability: "active",
    careGroup: "Outpatient",
    specializationTags: ["Standard"],
    currentQueueLoad: 0,
    slaMinutesRemainingAvg: 120,
  };
}

export function UnderwritersClient() {
  const [underwriters, setUnderwriters] = useState<Underwriter[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Underwriter>>({});

  useEffect(() => {
    setUnderwriters(getUnderwriters());
  }, []);

  function persist(next: Underwriter[]) {
    setUnderwriters(next);
    saveUnderwriters(next);
  }

  function handleSave() {
    if (!form.id || !form.name || !form.tier || !form.careGroup) return;
    const newUw: Underwriter = {
      id: form.id,
      name: form.name,
      tier: form.tier,
      authorityLimit: form.authorityLimit ? Number(form.authorityLimit) : null,
      specializationTags: form.specializationTags ?? [],
      currentQueueLoad: form.currentQueueLoad ?? 0,
      slaMinutesRemainingAvg: form.slaMinutesRemainingAvg ?? 0,
      availability: form.availability ?? "active",
      careGroup: form.careGroup,
    };
    const next =
      editingId === ""
        ? [...underwriters, newUw]
        : underwriters.map((u) => (u.id === editingId ? newUw : u));
    persist(next);
    setEditingId(null);
    setForm({});
  }

  function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this underwriter?")) return;
    persist(underwriters.filter((u) => u.id !== id));
  }

  function handleEdit(uw: Underwriter) {
    setEditingId(uw.id);
    setForm({ ...uw });
  }

  function handleAddNew() {
    setEditingId("");
    setForm(emptyForm());
  }

  function updateForm<K extends keyof Underwriter>(
    field: K,
    value: Underwriter[K],
  ) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <>
      <CommandBar>
        <CommandButton icon="+" primary onClick={handleAddNew}>
          Add Underwriter
        </CommandButton>
      </CommandBar>

      <RecordHeader
        recordType="Administration"
        title="Manage Underwriters"
        subtitle="View and manage the underwriter registry, care groups, capacity, and queue load."
      />

      <div className="space-y-4 p-6">
        {editingId !== null && (
          <FormSection
            title={editingId === "" ? "New Underwriter" : "Edit Underwriter"}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="field-label">
                ID
                <input
                  className="field-input"
                  value={form.id ?? ""}
                  disabled={editingId !== ""}
                  onChange={(e) => updateForm("id", e.target.value)}
                />
              </label>
              <label className="field-label">
                Name
                <input
                  className="field-input"
                  value={form.name ?? ""}
                  onChange={(e) => updateForm("name", e.target.value)}
                />
              </label>
              <label className="field-label">
                Tier
                <select
                  className="field-input"
                  value={form.tier ?? "Junior"}
                  onChange={(e) =>
                    updateForm("tier", e.target.value as Underwriter["tier"])
                  }
                >
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Care Group
                <select
                  className="field-input"
                  value={form.careGroup ?? "Outpatient"}
                  onChange={(e) =>
                    updateForm(
                      "careGroup",
                      e.target.value as Underwriter["careGroup"],
                    )
                  }
                >
                  {CARE_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Availability
                <select
                  className="field-input"
                  value={form.availability ?? "active"}
                  onChange={(e) =>
                    updateForm(
                      "availability",
                      e.target.value as Underwriter["availability"],
                    )
                  }
                >
                  {AVAILABILITY.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Authority Limit (USD, blank = unlimited)
                <input
                  className="field-input"
                  type="number"
                  value={form.authorityLimit ?? ""}
                  onChange={(e) =>
                    updateForm(
                      "authorityLimit",
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                />
              </label>
              <label className="field-label col-span-full">
                Specialization Tags (comma-separated)
                <input
                  className="field-input"
                  value={form.specializationTags?.join(", ") ?? ""}
                  onChange={(e) =>
                    updateForm(
                      "specializationTags",
                      e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </label>
              <label className="field-label">
                Current Queue Load
                <input
                  className="field-input"
                  type="number"
                  min={0}
                  value={form.currentQueueLoad ?? 0}
                  onChange={(e) =>
                    updateForm("currentQueueLoad", Number(e.target.value))
                  }
                />
              </label>
              <label className="field-label">
                Avg SLA Minutes Remaining
                <input
                  className="field-input"
                  type="number"
                  min={0}
                  value={form.slaMinutesRemainingAvg ?? 0}
                  onChange={(e) =>
                    updateForm("slaMinutesRemainingAvg", Number(e.target.value))
                  }
                />
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button className="primary-button" onClick={handleSave}>
                Save
              </button>
              <button
                className="ghost-button"
                onClick={() => setEditingId(null)}
              >
                Cancel
              </button>
            </div>
          </FormSection>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {underwriters.map((uw) => {
            const cap = queueLoadCapByTier[uw.tier];
            const loadPercent = Math.min(
              100,
              (uw.currentQueueLoad / cap) * 100,
            );
            const loadColor =
              loadPercent >= 100
                ? "bg-udred"
                : loadPercent > 75
                  ? "bg-udamber"
                  : "bg-udblue";
            const statusColor =
              uw.availability === "active" ? "text-green-600" : "text-udamber";

            return (
              <FormSection key={uw.id} title={uw.name}>
                <div className="grid gap-2 text-[13px]">
                  <div className="flex justify-between">
                    <span className="text-muted">ID:</span>
                    <span className="font-medium text-ink">{uw.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Tier:</span>
                    <span className="font-medium text-ink">{uw.tier}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Care Group:</span>
                    <span className="rounded bg-blue-50 py-0.5 font-medium text-udblue">
                      {uw.careGroup ?? "None"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Status:</span>
                    <span className={"font-medium " + statusColor}>
                      {uw.availability === "active"
                        ? "Active"
                        : uw.availability === "dnd"
                          ? "Do Not Disturb"
                          : "Offline"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Authority Limit:</span>
                    <span className="font-medium text-ink">
                      {uw.authorityLimit != null
                        ? "$" + uw.authorityLimit.toLocaleString()
                        : "Unlimited"}
                    </span>
                  </div>
                  <div>
                    <span className="mb-1 block text-muted">
                      Specializations:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {uw.specializationTags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-ink"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="mb-1 flex justify-between">
                      <span className="text-muted">Queue Load:</span>
                      <span className="font-medium text-ink">
                        {uw.currentQueueLoad} / {cap}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-slate-100">
                      <div
                        className={"h-full " + loadColor}
                        style={{ width: loadPercent + "%" }}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex gap-3 border-t border-line pt-3">
                    <button
                      className="text-[13px] font-medium text-udblue hover:underline"
                      onClick={() => handleEdit(uw)}
                    >
                      Edit
                    </button>
                    <button
                      className="text-[13px] font-medium text-udred hover:underline"
                      onClick={() => handleDelete(uw.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </FormSection>
            );
          })}
        </div>
      </div>
    </>
  );
}
