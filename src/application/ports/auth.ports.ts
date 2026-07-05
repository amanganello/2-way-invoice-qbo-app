export type OAuthStateEntry = {
  frontendUrl: string;
};

export interface OAuthStateStorePort {
  store(state: string, entry: OAuthStateEntry): Promise<void>;
  consume(state: string): Promise<OAuthStateEntry | null>;
}
