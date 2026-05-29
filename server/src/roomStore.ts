import type { Room } from "./types.js";

const ROOM_IDS_KEY = "slova-miny:roomIds";
const ROOM_KEY_PREFIX = "slova-miny:room:";

type RedisResponse<T> = {
  result?: T;
  error?: string;
};

export class RoomStore {
  private readonly restUrl = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  private readonly token = process.env.UPSTASH_REDIS_REST_TOKEN;

  get enabled(): boolean {
    return Boolean(this.restUrl && this.token);
  }

  async saveRoom(room: Room): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.command(["SET", this.roomKey(room.id), JSON.stringify(room)]);
    await this.command(["SADD", ROOM_IDS_KEY, room.id]);
  }

  async getRoom(roomId: string): Promise<Room | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    const result = await this.command<string | null>(["GET", this.roomKey(roomId)]);
    if (!result) {
      return undefined;
    }

    return JSON.parse(result) as Room;
  }

  async listRooms(): Promise<Room[]> {
    if (!this.enabled) {
      return [];
    }

    const roomIds = (await this.command<string[]>(["SMEMBERS", ROOM_IDS_KEY])) ?? [];
    const rooms = await Promise.all(roomIds.map((roomId) => this.getRoom(roomId)));
    return rooms.filter((room): room is Room => Boolean(room));
  }

  private async command<T>(command: unknown[]): Promise<T | undefined> {
    if (!this.restUrl || !this.token) {
      return undefined;
    }

    const response = await fetch(this.restUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(`Redis command failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as RedisResponse<T>;
    if (payload.error) {
      throw new Error(payload.error);
    }

    return payload.result;
  }

  private roomKey(roomId: string): string {
    return `${ROOM_KEY_PREFIX}${roomId.toUpperCase()}`;
  }
}
