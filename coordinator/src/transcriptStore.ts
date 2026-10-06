import { TranscriptTurn } from './compactionPolicy';

export class TranscriptStore {
  private transcripts = new Map<string, TranscriptTurn[]>();

  append(conversationId: string, turn: TranscriptTurn): void {
    const list = this.transcripts.get(conversationId) ?? [];
    list.push(turn);
    this.transcripts.set(conversationId, list);
  }

  get(conversationId: string): TranscriptTurn[] {
    return [...(this.transcripts.get(conversationId) ?? [])];
  }

  replace(conversationId: string, turns: TranscriptTurn[]): void {
    this.transcripts.set(conversationId, [...turns]);
  }

  delete(conversationId: string): void {
    this.transcripts.delete(conversationId);
  }

  clear(): void {
    this.transcripts.clear();
  }
}

export const transcriptStore = new TranscriptStore();
