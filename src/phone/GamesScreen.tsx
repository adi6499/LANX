/** LANX 3.2 phone page: the PC's games panel, full screen, through the PC
 *  (src/phone/bridge.ts routes its calls). Boards are the flat ones: a phone
 *  has no room (or battery) for the 3D tables. */
import { useEffect } from "react";
import type { Peer } from "../types";
import { GamesPanel } from "../components/games/GamesPanel";
import { api } from "../lib/api";
import { setGame3d } from "../lib/game3d";
import type { Me } from "./client";

export function GamesScreen({ me, peers, openMatchId, onBack, onError }: { me: Me; peers: Peer[]; openMatchId: string | null; onBack: () => void; onError: (t: string) => void }) {
  useEffect(() => {
    setGame3d(false);
  }, []);
  return (
    <GamesPanel
      initialQuery=""
      openMatchId={openMatchId}
      peers={peers}
      myId={me.id}
      myName={me.name}
      chatPeerId={null}
      onClose={onBack}
      onError={onError}
      onSendCard={async (card, peerId) => {
        const c = await api.getOrCreateConversation(peerId);
        await api.sendCard(c.id, card as unknown as Record<string, unknown>);
      }}
    />
  );
}
