
import Link from "next/link";
import BoardWorkspace from "@/components/whiteboard/board-workspace";

export const instant = false;

type BoardPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function BoardPage({
  params,
}: BoardPageProps) {
  const { roomId } = await params;

  return (
    <main className="board-page">
      <header className="board-header">
        <div className="board-header-left">
          <Link href="/" className="board-brand">
            <span className="brand-mark">B</span>
            <span>Brainstorm Space</span>
          </Link>

          <div className="board-header-divider" />

          <div className="board-title">
            <span className="board-title-name">Untitled board</span>
            <span className="board-save-status">
              <span className="save-status-dot" />
              Local workspace
            </span>
          </div>
        </div>

        <div className="board-header-right">
          <span className="board-room-id">
            Room {roomId.slice(0, 8)}
          </span>

          <button
            type="button"
            className="board-share-button"
            disabled
            title="Sharing will be available in a later feature"
          >
            Share
          </button>
        </div>
      </header>

      <BoardWorkspace roomId={roomId} />
    </main>
  );
}
