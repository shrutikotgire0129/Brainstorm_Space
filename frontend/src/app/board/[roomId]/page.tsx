
import Link from "next/link";
import WhiteboardCanvas from "@/components/whiteboard/whiteboard-canvas";

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

      <div className="board-toolbar">
        <button
          type="button"
          className="board-tool-button active"
          title="Select and pan"
        >
          <span>↖</span>
          <span className="tool-label">Select</span>
        </button>

        <div className="board-toolbar-divider" />

        <button
          type="button"
          className="board-tool-button"
          disabled
          title="Drawing tool coming soon"
        >
          <span>✎</span>
          <span className="tool-label">Draw</span>
        </button>

        <button
          type="button"
          className="board-tool-button"
          disabled
          title="Sticky notes coming soon"
        >
          <span>▤</span>
          <span className="tool-label">Notes</span>
        </button>

        <button
          type="button"
          className="board-tool-button"
          disabled
          title="Shapes coming soon"
        >
          <span>◇</span>
          <span className="tool-label">Shapes</span>
        </button>

        <button
          type="button"
          className="board-tool-button"
          disabled
          title="Text tool coming soon"
        >
          <span>T</span>
          <span className="tool-label">Text</span>
        </button>
      </div>

      <WhiteboardCanvas roomId={roomId} />
    </main>
  );
}
