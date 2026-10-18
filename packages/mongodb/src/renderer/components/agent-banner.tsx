/** Why members show no role: the agents could not be read. */
export function AgentBanner({ error }: { error?: string }) {
  if (!error) return null;

  return (
    <div className="MongoDB-banner" data-section="mongodb-agents">
      <div className="MongoDB-banner__title">Members' roles are unknown</div>
      <div className="MongoDB-banner__body">
        They come from each member's agent, which could not be read: {error}.
      </div>
    </div>
  );
}
