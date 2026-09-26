import {
  listMemory,
  type MemoryScope
} from "./memory.service.js";

import {
  buildHumanALEContextPacket,
  type HumanALEContextMode,
  type HumanALEContextPacket,
  type HumanALEContextTarget
} from "../humanale/context-packet.js";

export interface HumanALECloudContextInput {
  ownerId: string;
  target:
    HumanALEContextTarget;
  mode:
    HumanALEContextMode;
  scope?:
    MemoryScope;
  projectKey?:
    string;
  conversationId?:
    string;
}

export async function createHumanALECloudContext(
  input:
    HumanALECloudContextInput
): Promise<HumanALEContextPacket | null> {
  const memories =
    await listMemory({
      ownerId:
        input.ownerId,

      scope:
        input.scope,

      projectKey:
        input.projectKey,

      conversationId:
        input.conversationId,

      limit:
        50
    });

  return buildHumanALEContextPacket(
    memories.map(
      memory => ({
        id:
          memory.id,
        title:
          memory.title,
        content:
          memory.content
      })
    ),
    input.target,
    input.mode
  );
}
