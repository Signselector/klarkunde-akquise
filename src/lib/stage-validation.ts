/**
 * Checks the configured stage mapping against what Pipedrive really has. Pure logic, the data comes from the
 * connector. Nothing is invented: a missing or unknown ID is an error, a doubtful name is only a warning.
 * Synchronisation stays locked until the report has no error.
 */
export type PipedriveStage = {
  id: number;
  name: string;
  pipeline_id?: number | null;
  pipeline_name?: string | null;
};
export type PipedriveField = {
  key: string;
  name: string;
  field_type?: string;
  options?: { label: string }[];
};
export type ReportStatus = "ok" | "warning" | "error";
export type ReportItem = {
  key: string;
  label: string;
  status: ReportStatus;
  message: string;
  stageId?: number;
  stageName?: string;
  pipeline?: string;
};
export type ValidationReport = { ok: boolean; items: ReportItem[]; checkedAt: string };

export const REQUIRED_STAGES: { key: string; label: string; hint: RegExp; hintText: string }[] = [
  { key: "low_q", label: "Logo Render → 3D Low Q", hint: /low/i, hintText: "Low Q" },
  { key: "high_q", label: "Realismus Render → 3D High Q", hint: /high/i, hintText: "High Q" },
  { key: "waiting_3d", label: "Logo ausstehend → 3D Waiting", hint: /wait/i, hintText: "Waiting" },
  {
    key: "on_hold",
    label: "Zukunftsprojekt → Zukünftiges Interesse",
    hint: /zuk(ü|u)nft|hold|future/i,
    hintText: "Zukünftiges Interesse",
  },
];

export function buildValidationReport(input: {
  mapping: Record<string, unknown>;
  stages: PipedriveStage[];
  dealFields: PipedriveField[];
  personFields: PipedriveField[];
  originFieldKey: string | null;
  now?: Date;
}): ValidationReport {
  const byId = new Map(input.stages.map((s) => [s.id, s]));
  const items: ReportItem[] = [];
  const idOf = (key: string) => {
    const v = input.mapping[key];
    return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
  };
  const used = new Map<number, string[]>();
  for (const r of REQUIRED_STAGES) {
    const id = idOf(r.key);
    if (id !== null) used.set(id, [...(used.get(id) ?? []), r.key]);
  }
  for (const r of REQUIRED_STAGES) {
    const id = idOf(r.key);
    const base = { key: r.key, label: r.label };
    if (id === null) {
      items.push({
        ...base,
        status: "error",
        message: "Keine Stage-ID zugeordnet (Einstellungen → Stage Mapping).",
      });
      continue;
    }
    const stage = byId.get(id);
    if (!stage) {
      items.push({
        ...base,
        status: "error",
        stageId: id,
        message: `Die Stage-ID ${id} gibt es in Pipedrive nicht.`,
      });
      continue;
    }
    const detail = { stageId: id, stageName: stage.name, pipeline: stage.pipeline_name ?? "" };
    const shared = (used.get(id) ?? []).filter((k) => k !== r.key);
    if (shared.length) {
      items.push({
        ...base,
        ...detail,
        status: "error",
        message: `Dieselbe Stage-ID wird auch für ${shared.join(", ")} verwendet. Jede Aktion braucht eine eigene Stage.`,
      });
    } else if (!r.hint.test(stage.name)) {
      items.push({
        ...base,
        ...detail,
        status: "warning",
        message: `Die Stage heißt „${stage.name}“, erwartet wird etwa „${r.hintText}“. Bitte bestätigen, dass die Zuordnung stimmt.`,
      });
    } else {
      items.push({
        ...base,
        ...detail,
        status: "ok",
        message: `„${stage.name}“ in „${stage.pipeline_name ?? "?"}“.`,
      });
    }
  }

  // "Zukünftiges Interesse" is a deal stage in some accounts and a lifecycle option on the person in others.
  const futureStage = input.stages.find((s) => /zuk(ü|u)nftig/i.test(s.name));
  const lifecycle = input.personFields.find(
    (f) => /lifecycle/i.test(f.name) && f.options?.some((o) => /zuk(ü|u)nftig/i.test(o.label)),
  );
  const future = idOf("future_interest");
  const hold = idOf("on_hold");
  if (!futureStage && lifecycle) {
    items.push({
      key: "future_interest",
      label: "Zukünftiges Interesse",
      status: "error",
      message: `Zukünftiges Interesse ist hier ein Lifecycle-Stage-Wert der Person („${lifecycle.name}“), keine Deal-Stage. Das ist nicht austauschbar, die Zuordnung muss geklärt werden.`,
    });
  } else if (futureStage && hold !== null && futureStage.id !== hold) {
    items.push({
      key: "future_interest",
      label: "Zukünftiges Interesse",
      status: "error",
      stageId: futureStage.id,
      stageName: futureStage.name,
      message: `In Pipedrive gibt es die Deal-Stage „${futureStage.name}“ (ID ${futureStage.id}), zugeordnet ist aber die ID ${hold}.`,
    });
  } else if (future !== null && hold !== null && future !== hold) {
    items.push({
      key: "future_interest",
      label: "Zukünftiges Interesse",
      status: "warning",
      message:
        "„Zukunftsprojekt“ und „Zukünftiges Interesse“ sind unterschiedlichen Stages zugeordnet. Nur „Zukunftsprojekt“ wird verwendet.",
    });
  }

  const label = "Feld „Ursprünglicher Caller“";
  const field = input.originFieldKey
    ? input.dealFields.find((f) => f.key === input.originFieldKey)
    : null;
  if (!input.originFieldKey) {
    items.push({
      key: "origin_field",
      label,
      status: "error",
      message:
        "Es ist kein benutzerdefiniertes Deal-Feld für den ursprünglichen Caller hinterlegt (Einstellungen → Stage Mapping). Das Feld muss in Pipedrive angelegt sein, das Tool legt keine Felder an.",
    });
  } else if (!field) {
    items.push({
      key: "origin_field",
      label,
      status: "error",
      message: `Das Deal-Feld „${input.originFieldKey}“ gibt es in Pipedrive nicht.`,
    });
  } else if (field.field_type && !["varchar", "text", "varchar_auto"].includes(field.field_type)) {
    items.push({
      key: "origin_field",
      label,
      status: "warning",
      message: `Das Feld „${field.name}“ hat den Typ „${field.field_type}“. Ein Textfeld ist vorgesehen.`,
    });
  } else {
    items.push({
      key: "origin_field",
      label,
      status: "ok",
      message: `Feld „${field.name}“ gefunden.`,
    });
  }
  return {
    ok: items.every((i) => i.status !== "error"),
    items,
    checkedAt: (input.now ?? new Date()).toISOString(),
  };
}
