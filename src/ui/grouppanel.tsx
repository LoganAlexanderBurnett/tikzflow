// The properties panel's section for groups and swimlanes (D81): put the
// selected nodes in a group or a new lane, move them to another lane, take
// them out, and title a group or lane.
import { useSignal } from "@preact/signals";
import { boxName, type FitBox, fitBoxes, laneOrientation, laneSets } from "../edit/lanes.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { groupSelection, joinBox, laneFromSelection, leaveBoxes, setBoxTitle, text } from "./store.ts";

/** Title, members and kind of a selected group or lane. */
function BoxCard({ box, layout, lane }: { box: FitBox; layout: PictureLayout; lane: { index: number; count: number; rows: boolean } | null }) {
  const draft = useSignal<string | null>(null);
  const value = draft.value ?? box.title?.text ?? "";
  const names = box.members.map((id) => layout.nodes.find((n) => n.id === id)?.name ?? id);
  const apply = () => {
    if (setBoxTitle(box.node.id, value)) draft.value = null;
  };
  return (
    <section class="tf-groups" data-testid="box-card">
      <h3>{lane ? `Lane ${lane.index + 1} of ${lane.count}` : "Group"}</h3>
      <p class="tf-note">
        {lane ? `${lane.rows ? "Lanes lie one above the other" : "Lanes stand side by side"}; each is as ${lane.rows ? "wide" : "tall"} as the others. ` : ""}
        Holds {names.join(", ")}. Drag it to move them together{lane ? "; drop a node inside another lane to move it there" : ""}.
      </p>
      <label class="tf-title-field">
        <span>Title</span>
        <input
          data-testid="box-title"
          value={value}
          placeholder="No title"
          onInput={(e) => (draft.value = (e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
            if (e.key === "Escape") draft.value = null;
          }}
        />
        <button data-testid="box-title-apply" disabled={draft.value === null} onClick={apply}>
          Set
        </button>
      </label>
    </section>
  );
}

/** Actions for the selected nodes: group them, make a lane, move them to a lane, take them out. */
function NodeActions({ nodes, layout, boxes, selectedBox }: { nodes: LaidOutNode[]; layout: PictureLayout; boxes: FitBox[]; selectedBox: FitBox | null }) {
  const title = useSignal("");
  const sets = laneSets(text.value, layout, boxes);
  const set = sets[0];
  const ids = nodes.map((n) => n.id);
  const target = useSignal<string | null>(null);
  const lanes = set?.lanes ?? [];
  const chosen = lanes.find((l) => l.node.id === target.value) ?? lanes.find((l) => !ids.every((id) => l.members.includes(id)));
  const inBoxes = boxes.filter((b) => ids.some((id) => b.members.includes(id)));
  const orientation = set?.orientation ?? laneOrientation(layout);
  const run = (ok: boolean) => {
    if (ok) title.value = "";
  };
  return (
    <section class="tf-groups" data-testid="group-actions">
      <h3>Group and lanes</h3>
      <label class="tf-title-field">
        <span>Title</span>
        <input data-testid="group-title" value={title.value} placeholder={`Optional, e.g. ${set ? "Warehouse" : "Customer"}`} onInput={(e) => (title.value = (e.target as HTMLInputElement).value)} />
      </label>
      <div class="tf-fixes">
        <button data-testid="group-make" onClick={() => run(groupSelection(title.value))} title="Draw a box around the selected nodes, on the background layer (fit and backgrounds libraries)">
          Group
        </button>
        <button
          data-testid="lane-make"
          onClick={() => run(laneFromSelection(title.value))}
          title={
            set
              ? "A new lane next to the others, holding the selected nodes"
              : `The first lane: ${orientation === "columns" ? "lanes stand side by side, since the picture runs down" : "lanes lie one above the other, since the picture runs across"}. Every lane is as ${orientation === "columns" ? "tall" : "wide"} as the others.`
          }
        >
          New lane
        </button>
      </div>
      {selectedBox && nodes.length > 0 && (
        <div class="tf-fixes">
          <button data-testid="box-join" onClick={() => joinBox(ids, selectedBox.node.id)} title={`List the other selected nodes in ${boxName(selectedBox)} too`}>
            Add to {boxName(selectedBox)}
          </button>
        </div>
      )}
      {!selectedBox && lanes.length > 0 && chosen && (
        <div class="tf-attach">
          <button data-testid="lane-move" onClick={() => joinBox(ids, chosen.node.id)} title="Move the selected nodes to this lane; they leave their own">
            Move to lane
          </button>
          <select value={chosen.node.id} onChange={(e) => (target.value = (e.target as HTMLSelectElement).value)} aria-label="Lane to move to">
            {lanes.map((l) => (
              <option value={l.node.id}>{boxName(l)}</option>
            ))}
          </select>
        </div>
      )}
      {inBoxes.length > 0 && (
        <div class="tf-fixes">
          <button data-testid="box-leave" onClick={() => leaveBoxes(ids)} title="Take the selected nodes out of their groups and lanes; the boxes shrink to what is left">
            Take out of {inBoxes.map(boxName).join(" and ")}
          </button>
        </div>
      )}
    </section>
  );
}

/** The groups section of the properties panel for the selected nodes. */
export function GroupPanel({ layout, nodes }: { layout: PictureLayout; nodes: LaidOutNode[] }) {
  const boxes = fitBoxes(text.value, layout);
  const sets = laneSets(text.value, layout, boxes);
  const selectedBoxes = nodes.flatMap((n) => boxes.find((b) => b.node.id === n.id) ?? []);
  const plain = nodes.filter((n) => n.kind === "statement" && n.position.kind !== "fit" && n.shape.kind !== "coordinate");
  const primary = nodes[nodes.length - 1];
  const card = selectedBoxes.find((b) => b.node.id === primary?.id) ?? (plain.length ? undefined : selectedBoxes[0]);
  const laneInfo = (b: FitBox) => {
    for (const s of sets) {
      const i = s.lanes.findIndex((l) => l.node.id === b.node.id);
      if (i >= 0) return { index: i, count: s.lanes.length, rows: s.orientation === "rows" };
    }
    return null;
  };
  return (
    <>
      {card && <BoxCard key={card.node.id} box={card} layout={layout} lane={laneInfo(card)} />}
      {plain.length > 0 && <NodeActions nodes={plain} layout={layout} boxes={boxes} selectedBox={selectedBoxes.length === 1 ? selectedBoxes[0]! : null} />}
    </>
  );
}
