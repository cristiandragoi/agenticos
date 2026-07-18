import { useBoards, useColumns } from '../../lib/dataport';
import Board from './Board';

interface Props {
  boardId?: string;
}

export default function KanbanContainer({ boardId }: Props) {
  const boards = useBoards();
  
  // If a boardId is provided, find that board. Otherwise, default to Mission Control.
  const activeBoard: any = boardId 
    ? boards.find((b: any) => b.id === boardId) 
    : (boards.find((b: any) => b.name === 'Mission Control') || boards[0]);
  
  const columns = useColumns(activeBoard?.id);

  if (!activeBoard) {
    return <div style={{ color: 'var(--text-secondary)' }}>Loading or No Boards found...</div>;
  }

  return (
    <div style={{ marginTop: 24 }}>
      <Board boardId={activeBoard.id} columns={columns} />
    </div>
  );
}
