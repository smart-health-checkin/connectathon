// Questionnaire rendering and QuestionnaireResponse building (spec §5.4.2).

type Coding = { system?: string; code?: string; display?: string };
type AnswerOption = { valueCoding?: Coding; valueString?: string; valueInteger?: number };
type EnableWhen = {
  question: string;
  operator: "exists" | "=" | "!=" | ">" | "<" | ">=" | "<=";
  answerBoolean?: boolean;
  answerCoding?: Coding;
  answerString?: string;
  answerInteger?: number;
};
export type QItem = {
  linkId: string;
  text?: string;
  prefix?: string;
  type: string;
  required?: boolean;
  repeats?: boolean;
  readOnly?: boolean;
  answerOption?: AnswerOption[];
  enableWhen?: EnableWhen[];
  enableBehavior?: "any" | "all";
  item?: QItem[];
  code?: Coding[];
};
export type Questionnaire = { resourceType: "Questionnaire"; url?: string; version?: string; title?: string; item?: QItem[] };

type Answer = { valueCoding?: Coding; valueString?: string; valueInteger?: number; valueDecimal?: number; valueBoolean?: boolean; valueDate?: string };
export type FormState = {
  questionnaire: Questionnaire;
  answers: Map<string, Answer[]>;
  prefilled: Set<string>;
};

const splitCanonical = (c: string) => {
  const bar = c.indexOf("|");
  return bar < 0 ? { url: c, version: undefined } : { url: c.slice(0, bar), version: c.slice(bar + 1) };
};

/**
 * Resolve the Questionnaire for a form.fhir item: the inline body if present,
 * otherwise fetch the canonical. A versioned canonical is fetched at its base
 * URL and used only if the fetched version matches.
 */
export async function resolveQuestionnaire(content: { questionnaire?: Questionnaire; questionnaireCanonical?: string }): Promise<Questionnaire> {
  if (content.questionnaire) {
    if (content.questionnaire.resourceType !== "Questionnaire") throw new Error("inline questionnaire is not a Questionnaire");
    return content.questionnaire;
  }
  const canonical = content.questionnaireCanonical;
  if (!canonical) throw new Error("form item has neither questionnaire nor questionnaireCanonical");
  const { url, version } = splitCanonical(canonical);
  const res = await fetch(url, { headers: { Accept: "application/fhir+json, application/json" } });
  if (!res.ok) throw new Error(`could not fetch ${url}: HTTP ${res.status}`);
  const q = (await res.json()) as Questionnaire;
  if (q.resourceType !== "Questionnaire") throw new Error(`${url} did not return a Questionnaire`);
  if (q.url !== url) throw new Error(`${url} returned a Questionnaire whose url is ${q.url}`);
  if (version !== undefined && q.version !== version) throw new Error(`${url} has version ${q.version ?? "(none)"}, not ${version}`);
  return q;
}

const sameCoding = (a?: Coding, b?: Coding) => !!a && !!b && a.code === b.code && (a.system ?? "") === (b.system ?? "");
function answerMatches(ans: Answer, ew: EnableWhen): boolean {
  if (ew.answerCoding) return sameCoding(ans.valueCoding, ew.answerCoding);
  if (ew.answerBoolean !== undefined) return ans.valueBoolean === ew.answerBoolean;
  if (ew.answerString !== undefined) return ans.valueString === ew.answerString;
  if (ew.answerInteger !== undefined) return ans.valueInteger === ew.answerInteger;
  return false;
}

export function isEnabled(item: QItem, state: FormState): boolean {
  if (!item.enableWhen?.length) return true;
  const results = item.enableWhen.map((ew) => {
    const answers = state.answers.get(ew.question) ?? [];
    switch (ew.operator) {
      case "exists":
        return (answers.length > 0) === (ew.answerBoolean ?? true);
      case "=":
        return answers.some((a) => answerMatches(a, ew));
      case "!=":
        return answers.length > 0 && !answers.some((a) => answerMatches(a, ew));
      default:
        return false;
    }
  });
  return (item.enableBehavior ?? "any") === "all" ? results.every(Boolean) : results.some(Boolean);
}

/** Prefill answers from the record: an item whose code has a matching Observation starts filled. */
export function prefill(state: FormState, observations: Array<{ code?: { coding?: Coding[] }; valueQuantity?: { value?: number }; valueString?: string }>) {
  const walk = (items: QItem[] = []) => {
    for (const item of items) {
      const codes = item.code ?? [];
      const obs = observations.find((o) => o.code?.coding?.some((c) => codes.some((k) => sameCoding(c, k))));
      if (obs && !state.answers.has(item.linkId)) {
        if ((item.type === "decimal" || item.type === "integer") && typeof obs.valueQuantity?.value === "number") {
          state.answers.set(item.linkId, [item.type === "integer" ? { valueInteger: Math.round(obs.valueQuantity.value) } : { valueDecimal: obs.valueQuantity.value }]);
          state.prefilled.add(item.linkId);
        } else if ((item.type === "string" || item.type === "text") && obs.valueString) {
          state.answers.set(item.linkId, [{ valueString: obs.valueString }]);
          state.prefilled.add(item.linkId);
        }
      }
      walk(item.item);
    }
  };
  walk(state.questionnaire.item);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

/** Render the form into `host`. Re-renders on every change so enableWhen stays live. */
export function renderForm(host: HTMLElement, state: FormState, idPrefix: string) {
  const draw = () => {
    const focusedId = (document.activeElement as HTMLElement | null)?.id;
    host.replaceChildren(...renderItems(state.questionnaire.item ?? []));
    if (focusedId) (document.getElementById(focusedId) as HTMLElement | null)?.focus();
  };
  const set = (linkId: string, answers: Answer[]) => {
    if (answers.length) state.answers.set(linkId, answers);
    else state.answers.delete(linkId);
    state.prefilled.delete(linkId);
    draw();
  };
  const renderItems = (items: QItem[]): Node[] => items.filter((i) => isEnabled(i, state)).map(renderItem);
  const renderItem = (item: QItem): Node => {
    const id = `${idPrefix}-${item.linkId}`;
    const label = `${item.prefix ? item.prefix + " " : ""}${item.text ?? ""}`;
    const current = state.answers.get(item.linkId) ?? [];
    const wrap = el("div", { className: `q q-${item.type}` });
    const heading = el("div", { className: "q-text" }, label);
    if (item.required) heading.append(el("span", { className: "q-req" }, " (the clinic marks this required)"));
    if (state.prefilled.has(item.linkId)) heading.append(el("span", { className: "q-prefilled" }, " filled in from your record"));

    if (item.type === "display") {
      wrap.append(el("p", { className: "q-display" }, item.text ?? ""));
      return wrap;
    }
    if (item.type === "group") {
      wrap.append(heading, ...renderItems(item.item ?? []));
      return wrap;
    }
    wrap.append(heading);

    if (item.type === "choice" || item.type === "open-choice") {
      const options = item.answerOption ?? [];
      const multi = !!item.repeats;
      const list = el("div", { className: "q-options" });
      options.forEach((opt, i) => {
        const optId = `${id}-${i}`;
        const text = opt.valueCoding?.display ?? opt.valueString ?? String(opt.valueInteger ?? opt.valueCoding?.code ?? "");
        const checked = current.some((a) => (opt.valueCoding ? sameCoding(a.valueCoding, opt.valueCoding) : a.valueString === opt.valueString));
        const input = el("input", { type: multi ? "checkbox" : "radio", name: id, id: optId, checked });
        input.onchange = () => {
          const pick: Answer = opt.valueCoding ? { valueCoding: opt.valueCoding } : opt.valueString !== undefined ? { valueString: opt.valueString } : { valueInteger: opt.valueInteger };
          const others = current.filter((a) => !(opt.valueCoding ? sameCoding(a.valueCoding, opt.valueCoding) : a.valueString === opt.valueString));
          if (multi) set(item.linkId, input.checked ? [...others, pick] : others);
          else set(item.linkId, [pick, ...current.filter((a) => a.valueString !== undefined && item.type === "open-choice" && !options.some((o) => o.valueString === a.valueString))]);
        };
        list.append(el("label", { htmlFor: optId, className: "q-option" }, input, " ", text));
      });
      if (!multi && current.length && item.type === "choice") {
        const clear = el("button", { type: "button", className: "smart-btn link sm" }, "Clear");
        clear.onclick = () => set(item.linkId, []);
        list.append(clear);
      }
      wrap.append(list);
      if (item.type === "open-choice") {
        const typed = current.find((a) => a.valueString !== undefined && !options.some((o) => o.valueString === a.valueString));
        const other = el("input", { type: "text", id: `${id}-other`, placeholder: "Or describe it in your own words", value: typed?.valueString ?? "" });
        other.onchange = () => {
          const coded = current.filter((a) => a.valueCoding || options.some((o) => o.valueString === a.valueString));
          set(item.linkId, other.value.trim() ? [...(multi ? coded : []), { valueString: other.value.trim() }] : coded);
        };
        wrap.append(other);
      }
      return wrap;
    }

    if (item.type === "boolean") {
      const row = el("div", { className: "q-options" });
      for (const [v, text] of [[true, "Yes"], [false, "No"]] as const) {
        const optId = `${id}-${v}`;
        const input = el("input", { type: "radio", name: id, id: optId, checked: current[0]?.valueBoolean === v });
        input.onchange = () => set(item.linkId, [{ valueBoolean: v }]);
        row.append(el("label", { htmlFor: optId, className: "q-option" }, input, " ", text));
      }
      wrap.append(row);
      return wrap;
    }

    const kinds: Record<string, { type: string; read: (s: string) => Answer | undefined; show: (a?: Answer) => string }> = {
      integer: { type: "number", read: (s) => (s.trim() === "" ? undefined : { valueInteger: Math.trunc(Number(s)) }), show: (a) => (a?.valueInteger ?? "").toString() },
      decimal: { type: "number", read: (s) => (s.trim() === "" ? undefined : { valueDecimal: Number(s) }), show: (a) => (a?.valueDecimal ?? "").toString() },
      date: { type: "date", read: (s) => (s ? { valueDate: s } : undefined), show: (a) => a?.valueDate ?? "" },
      string: { type: "text", read: (s) => (s.trim() ? { valueString: s.trim() } : undefined), show: (a) => a?.valueString ?? "" },
    };
    if (item.type === "text") {
      const area = el("textarea", { id, rows: 3, value: current[0]?.valueString ?? "" });
      area.onchange = () => set(item.linkId, area.value.trim() ? [{ valueString: area.value.trim() }] : []);
      wrap.append(area);
      return wrap;
    }
    const kind = kinds[item.type] ?? kinds.string!;
    const input = el("input", { id, type: kind.type, value: kind.show(current[0]) });
    if (item.type === "integer") input.step = "1";
    input.onchange = () => {
      const a = kind.read(input.value);
      set(item.linkId, a ? [a] : []);
    };
    wrap.append(input);
    return wrap;
  };
  draw();
}

/** Build the QuestionnaireResponse. Hidden and unanswered items are left out. */
export function buildQuestionnaireResponse(state: FormState, canonical: string | undefined, patientRef: string) {
  const build = (items: QItem[] = []): unknown[] =>
    items
      .filter((i) => i.type !== "display" && isEnabled(i, state))
      .flatMap((i): unknown[] => {
        if (i.type === "group") {
          const children = build(i.item);
          return children.length ? [{ linkId: i.linkId, ...(i.text ? { text: i.text } : {}), item: children }] : [];
        }
        const answers = state.answers.get(i.linkId);
        return answers?.length ? [{ linkId: i.linkId, ...(i.text ? { text: i.text } : {}), answer: answers }] : [];
      });
  const q = state.questionnaire;
  return {
    resourceType: "QuestionnaireResponse",
    // Echo the requested canonical exactly, including any |version (§5.5).
    ...(canonical ? { questionnaire: canonical } : q.url ? { questionnaire: q.version ? `${q.url}|${q.version}` : q.url } : {}),
    status: "completed",
    subject: { reference: patientRef },
    authored: new Date().toISOString(),
    item: build(q.item),
  };
}
