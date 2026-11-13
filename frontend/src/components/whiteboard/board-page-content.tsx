"use client";

import { useState } from "react";
import BoardHeader from "./board-header";
import BoardWorkspace from "./board-workspace";

type BoardPageContentProps = {
  roomId: string;
};

export default function BoardPageContent({ roomId }: BoardPageContentProps) {
  const [boardName, setBoardName] = useState("Untitled Board");

  return (
    <main className="board-page">
      <BoardHeader
        roomId={roomId}
        boardName={boardName}
        onBoardNameChange={setBoardName}
      />

      <BoardWorkspace roomId={roomId} onRoomNameChange={setBoardName} />
    </main>
  );
}
