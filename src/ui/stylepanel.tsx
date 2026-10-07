// The style panel: the figure's styles (change one and every node using it
// follows) and options that several nodes repeat, with a button to factor
// them into a named style.
import { signal, useSignal } from "@preact/signals";
import { findRepeats, styleBodyProblem, styleInfos, styleNameProblem } from "../edit/styleedit.ts";
import { applyStyleBody, baseLayout, currentPicture, doc, factorOptions, selectNodes } from "./store.ts";

const open = signal(true);

function StyleRow({ info }: { info: ReturnType<typeof styleInfos>[number] }) {
  const editing = useSignal(false);
  const draft = useSignal("");
  const n = info.users.length;
  const problem = editing.value && info.body !== undefined ? styleBodyProblem(draft.value, "{") : null;
  return (
    <li class="tf-style" data-testid={`style-${info.name}`}>
      <div class="tf-style-head">
        <span class="tf-style-name">{info.name}</span>
        <span class="tf-style-count">{n === 1 ? "1 node" : `${n} nodes`}</span>
        <button class="link" disabled={!n} onClick={() => selectNodes(info.users.map((u) => u.id))} title="Select the nodes that use this style">
          Select
        </button>
        <button
          class="link"
          disabled={info.body === undefined}
          title={info.reason ?? "Edit the style's options; every node using it changes"}
          onClick={() => {
            draft.value = info.body ?? "";
            editing.value = !editing.value;
          }}
        >
          {editing.value ? "Close" : "Edit"}
        </button>
      </div>
      {editing.value && info.body !== undefined && (
        <div class="tf-style-edit">
          <textarea
            value={draft.value}
            rows={Math.min(8, Math.max(2, draft.value.split("\n").length))}
            spellcheck={false}
            aria-label={`Options of the ${info.name} style`}
            aria-invalid={!!problem}
            onInput={(e) => (draft.value = (e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          {problem && <p class="tf-problem">{problem}</p>}
          {info.appended > 0 && <p class="tf-note">{info.appended === 1 ? "A later .append style" : `${info.appended} later .append styles`} stay as written.</p>}
          <div class="tf-custom-actions">
            <button
              disabled={!!problem || draft.value === info.body}
              onClick={() => {
                if (applyStyleBody(info.name, draft.value)) editing.value = false;
              }}
            >
              Apply to {n === 1 ? "1 node" : `${n} nodes`}
            </button>
            <button class="link" onClick={() => (editing.value = false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function RepeatRow({ rep }: { rep: ReturnType<typeof findRepeats>[number] }) {
  const d = doc.value;
  const pic = d.syntax.pictures[currentPicture.value];
  const name = useSignal<string | null>(null);
  const value = name.value ?? rep.suggestion;
  const problem = pic ? styleNameProblem(d, pic, value) : "There is no picture.";
  return (
    <li class="tf-repeat" data-testid="repeat">
      <p>
        <button class="link" onClick={() => selectNodes(rep.nodes)} title="Select these nodes">
          {rep.nodes.length} nodes
        </button>{" "}
        each write <code>{rep.items.join(", ")}</code>
      </p>
      <div class="tf-custom">
        <input
          type="text"
          value={value}
          aria-label="Name for the new style"
          aria-invalid={!!problem}
          onInput={(e) => (name.value = (e.target as HTMLInputElement).value.trim())}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button disabled={!!problem} title={problem ?? `Defines ${value} and uses it in those nodes`} onClick={() => factorOptions(rep, value)}>
          Factor out
        </button>
      </div>
      {problem && <p class="tf-problem">{problem}</p>}
    </li>
  );
}

export function StylePanel() {
  const d = doc.value;
  const pic = d.syntax.pictures[currentPicture.value];
  const l = baseLayout.value;
  if (!pic || !l) return null;
  const styles = styleInfos(d, pic, l);
  const repeats = findRepeats(d, pic, l);
  return (
    <section class="tf-styles" data-testid="style-panel">
      <button class="tf-styles-toggle" aria-expanded={open.value} onClick={() => (open.value = !open.value)}>
        <span aria-hidden="true">{open.value ? "▾" : "▸"}</span> Styles
        <span class="tf-style-count">{styles.length}</span>
        {repeats.length > 0 && (
          <span class="tf-badge" title="Options several nodes repeat">
            {repeats.length} to factor
          </span>
        )}
      </button>
      {open.value && (
        <>
          {styles.length ? (
            <ul class="tf-style-list">
              {styles.map((s) => (
                <StyleRow key={s.name} info={s} />
              ))}
            </ul>
          ) : (
            <p class="tf-empty">This figure defines no styles yet.</p>
          )}
          {repeats.length > 0 && (
            <>
              <h4>Repeated options</h4>
              <p class="tf-note">Several nodes spell out the same options. A style says it once.</p>
              <ul class="tf-style-list">
                {repeats.map((r) => (
                  <RepeatRow key={r.items.join("|")} rep={r} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
