"use client";
import { DndContext, closestCenter } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { useState } from "react";
import { useCards, useLanes, useKanbanMutations } from "../../lib/dataport";
import LaneBadge from "./LaneBadge";
import RunStream from "./RunStream";

type Column = { id: string; name: string };
type Lane = {
  id: string;
  columnId: string;
  name: string;
  kind: string;
  config: any;
  order: number;
};
type Card = {
  id: string;
  laneId: string;
  title: string;
  body: string;
  order: number;
  state: string;
  currentRunId?: string;
};

export default function Board({
  boardId,
  columns,
}: {
  boardId: string;
  columns: Column[];
}) {
  void boardId;
  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 16 }}>
        {columns.map((c) => (
          <ColumnView key={c.id} column={c} />
        ))}
      </div>
    </DndContext>
  );

  function onDragEnd(e: DragEndEvent) {
    const { moveCard } = useKanbanMutationsStandalone();
    const overLaneId = e.over?.id?.toString().split(":")[1];
    if (!overLaneId) return;
    const cardId = e.active.id.toString().split(":")[1];
    if (!cardId) return;
    void moveCard({
      cardId: cardId as any,
      toLaneId: overLaneId as any,
      toOrder: 0,
    });
  }
}

// Hook indirection so onDragEnd can be defined outside the render tree but
// still pick up the latest mutations from the React tree above.
function useKanbanMutationsStandalone() {
  return useKanbanMutations();
}

function ColumnView({ column }: { column: Column }) {
  const lanes = useLanes(column.id);
  if (!lanes) return <ColumnShell name={column.name}>{null}</ColumnShell>;

  return (
    <ColumnShell name={column.name}>
      {(lanes as Lane[]).map((lane) => (
        <LaneColumn key={lane.id} lane={lane} />
      ))}
    </ColumnShell>
  );
}

function ColumnShell({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minWidth: 320,
        background: "#0f1115",
        borderRadius: 12,
        padding: 12,
        color: "#eee",
      }}
    >
      <h3 style={{ marginTop: 0 }}>{name}</h3>
      {children}
    </div>
  );
}

function LaneColumn({ lane }: { lane: Lane }) {
  const cards = useCards(lane.id);
  const { createCard } = useKanbanMutations();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  return (
    <div
      id={`lane:${lane.id}`}
      style={{
        background: "#161a22",
        borderRadius: 8,
        padding: 8,
        marginBottom: 12,
      }}
      data-droppable="true"
    >
      <div key="header" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <LaneBadge kind={lane.kind} />
        <h4 style={{ margin: 0 }}>{lane.name}</h4>
      </div>
      {cards?.map((card: any) => (
        <CardItem key={card.id} card={card as Card} />
      ))}
      <form key="new-card-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title) return;
          await createCard({
            laneId: lane.id as any,
            title,
            body,
            order: (cards as any[] | undefined)?.length ?? 0,
          });
          setTitle("");
          setBody("");
        }}
        style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Card title"
          style={{
            background: "#0f1115",
            color: "#eee",
            border: "1px solid #2a2f3a",
            borderRadius: 4,
            padding: 4,
          }}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Prompt / body"
          style={{
            background: "#0f1115",
            color: "#eee",
            border: "1px solid #2a2f3a",
            borderRadius: 4,
            padding: 4,
            minHeight: 60,
          }}
        />
        <button type="submit">Add card</button>
      </form>
    </div>
  );
}

function CardItem({ card }: { card: Card }) {
  const stateColor =
    card.state === "error"
      ? "#ff6b6b"
      : card.state === "done"
      ? "#51cf66"
      : "#aaa";
  return (
    <div
      id={`card:${card.id}`}
      draggable
      style={{
        background: "#1f2430",
        borderRadius: 6,
        padding: 8,
        marginBottom: 6,
        cursor: "grab",
      }}
    >
      <div style={{ fontWeight: 600 }}>{card.title}</div>
      <div style={{ fontSize: 12, opacity: 0.7, whiteSpace: "pre-wrap" }}>
        {card.body}
      </div>
      <div style={{ fontSize: 11, marginTop: 4, color: stateColor }}>
        {card.state}
        {card.currentRunId && <RunStream runId={card.currentRunId} />}
      </div>
    </div>
  );
}
