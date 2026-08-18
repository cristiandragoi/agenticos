// @ts-nocheck
import React from 'react';
import { useData } from '../../store/dataStore';
import { Clock, User, ArrowRight } from 'lucide-react';

const Activity: React.FC = () => {
  const { agents } = useData();
  const fleet = agents || [];

  // Build timeline from agent recentActivity
  const timeline = fleet
    .filter((a: any) => a.recentActivity && a.status === 'active')
    .map((a: any) => ({
      agentId: a.id,
      agentName: a.name,
      agentColor: a.color,
      agentAvatar: a.avatar,
      message: a.recentActivity,
      timestamp: a.updatedAt,
    }))
    .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="jarvis-activity">
      <div className="jarvis-activity__header">
        <h2>Live Activity Feed</h2>
        <span className="text-dim">{timeline.length} recent events</span>
      </div>
      <div className="jarvis-activity__timeline">
        {timeline.map((event: any, i: number) => (
          <div key={`${event.agentId}-${i}`} className="jarvis-timeline-item">
            <div className="jarvis-timeline-item__line">
              <div
                className="jarvis-timeline-item__dot"
                style={{ backgroundColor: event.agentColor, boxShadow: `0 0 8px ${event.agentColor}66` }}
              />
              {i < timeline.length - 1 && <div className="jarvis-timeline-item__connector" />}
            </div>
            <div className="jarvis-timeline-item__content">
              <div className="jarvis-timeline-item__header">
                <span
                  className="jarvis-timeline-item__agent"
                  style={{ color: event.agentColor }}
                >
                  {event.agentName}
                </span>
                <span className="text-xxs text-dim">
                  <Clock size={10} />
                  {new Date(event.timestamp).toLocaleString()}
                </span>
              </div>
              <p className="jarvis-timeline-item__message">{event.message}</p>
            </div>
          </div>
        ))}
        {timeline.length === 0 && (
          <div className="jarvis-empty">No recent activity</div>
        )}
      </div>
    </div>
  );
};

export default Activity;