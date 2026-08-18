import React from 'react';

interface BoardColumnProps {
  title: string;
  count: number;
  children: React.ReactNode;
}

const BoardColumn: React.FC<BoardColumnProps> = ({ title, count, children }) => {
  return (
    <div className="board-column">
      <div className="board-column__header">
        <div className="board-column__title">{title}</div>
        <div className="board-column__count">{count}</div>
      </div>
      <div className="board-column__body">
        {React.Children.count(children) === 0 ? (
          <div className="board-column__empty">
            <span style={{ display: 'block', marginBottom: 4 }}>Connected but empty</span>
            <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>No items found</span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
};

export default BoardColumn;

