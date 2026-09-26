import {
  findMemory,
  listMemory,
  type MemoryRecord,
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
  entryIds?:
    string[];
}

function matchesFilters(
  memory:
    MemoryRecord,
  input:
    HumanALECloudContextInput
): boolean {
  if (
    input.scope &&
    memory.scope !==
      input.scope
  ) {
    return false;
  }

  if (
    input.projectKey &&
    memory.projectKey !==
      input.projectKey
  ) {
    return false;
  }

  if (
    input.conversationId &&
    memory.conversationId !==
      input.conversationId
  ) {
    return false;
  }

  return true;
}

async function exactMemories(
  input:
    HumanALECloudContextInput
): Promise<MemoryRecord[] | null> {
  if (
    !input.entryIds ||
    input.entryIds.length ===
      0
  ) {
    return null;
  }

  const uniqueIds =
    [
      ...new Set(
        input.entryIds
      )
    ];

  if (
    uniqueIds.length !==
      input.entryIds.length ||
    uniqueIds.length > 6
  ) {
    return null;
  }

  const memories:
    MemoryRecord[] = [];

  for (
    const id of
      uniqueIds
  ) {
    const memory =
      await findMemory(
        input.ownerId,
        id
      );

    if (
      !memory ||
      !matchesFilters(
        memory,
        input
      )
    ) {
      return null;
    }

    memories.push(
      memory
    );
  }

  return memories;
}

export async function createHumanALECloudContext(
  input:
    HumanALECloudContextInput
): Promise<HumanALEContextPacket | null> {
  let memories:
    MemoryRecord[];

  if (
    input.entryIds
  ) {
    const exact =
      await exactMemories(
        input
      );

    if (!exact) {
      return null;
    }

    memories =
      exact;
  } else {
    memories =
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
  }

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
