import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "../ClientEnv";
import { translateText } from "../Utils";
import {
  acceptFriend,
  currentUser,
  fetchFriends,
  fetchLeaderboard,
  fetchOpenLobbies,
  fetchProfile,
  Friend,
  FriendsView,
  LeaderboardEntry,
  login,
  logout,
  OpenLobby,
  Profile,
  register,
  removeFriend,
  requestFriend,
  SOCIAL_AUTH_EVENT,
  SocialApiError,
  SocialUser,
} from "./SocialApi";

const POLL_OPEN_MS = 5_000;
const POLL_CLOSED_MS = 20_000;

type Tab = "games" | "friends" | "ranks";

/**
 * The social sidebar: this server's open lobbies (join with one click, no
 * links), the player's account, and friends with live status and Join /
 * Spectate buttons.
 */
@customElement("social-panel")
export class SocialPanel extends LitElement {
  @state() private open = false;
  @state() private tab: Tab = "games";
  @state() private user: SocialUser | null = currentUser();
  @state() private view: FriendsView | null = null;
  @state() private lobbies: OpenLobby[] = [];
  @state() private leaderboard: LeaderboardEntry[] = [];
  @state() private profile: Profile | null = null;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;
  @state() private busy = false;
  @state() private authMode: "login" | "register" = "login";

  private timer: ReturnType<typeof setTimeout> | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(SOCIAL_AUTH_EVENT, this.onAuthChanged);
    window.addEventListener("social-open", this.onOpenRequest);
    void this.refresh();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(SOCIAL_AUTH_EVENT, this.onAuthChanged);
    window.removeEventListener("social-open", this.onOpenRequest);
    if (this.timer) clearTimeout(this.timer);
  }

  // Other UI (the play page's "Open games" button) opens a given tab.
  private onOpenRequest = (e: Event) => {
    const tab = (e as CustomEvent<Tab>).detail;
    if (tab === "games" || tab === "friends" || tab === "ranks") {
      this.tab = tab;
    }
    this.open = true;
    void this.refresh();
  };

  private onAuthChanged = () => {
    this.user = currentUser();
    this.view = null;
    void this.refresh();
  };

  private async refresh(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    try {
      this.lobbies = await fetchOpenLobbies();
      if (this.user) this.view = await fetchFriends();
      if (this.open && this.tab === "ranks") {
        this.leaderboard = await fetchLeaderboard();
        this.profile = this.user ? await fetchProfile() : null;
      }
    } catch {
      // Offline for a moment; the next poll retries.
    }
    this.timer = setTimeout(
      () => void this.refresh(),
      this.open ? POLL_OPEN_MS : POLL_CLOSED_MS,
    );
  }

  private toggle() {
    this.open = !this.open;
    if (this.open) void this.refresh();
  }

  private errorText(err: unknown): string {
    const code = err instanceof SocialApiError ? err.code : "network";
    const key = `social.error.${code}`;
    const text = translateText(key);
    return text === key ? translateText("social.error.generic") : text;
  }

  private async run(fn: () => Promise<unknown>, notice?: string) {
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      await fn();
      if (notice) this.notice = notice;
      await this.refresh();
    } catch (err) {
      this.error = this.errorText(err);
    } finally {
      this.busy = false;
    }
  }

  private submitAuth(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const username = String(data.get("username") ?? "").trim();
    const password = String(data.get("password") ?? "");
    void this.run(async () => {
      if (this.authMode === "register") await register(username, password);
      else await login(username, password);
      // Show the new name in the name box right away.
      const input = document.querySelector("username-input") as
        | (HTMLElement & { baseUsername?: string; requestUpdate?: () => void })
        | null;
      if (input) {
        input.baseUsername = username;
        input.requestUpdate?.();
      }
      this.tab = "friends";
    });
  }

  private submitFriend(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const username = String(new FormData(form).get("friend") ?? "").trim();
    if (!username) return;
    void this.run(async () => {
      const r = await requestFriend(username);
      form.reset();
      this.notice = translateText(
        r.result === "accepted" ? "social.now_friends" : "social.request_sent",
        { name: username },
      );
    });
  }

  private join(gameId: string) {
    window.location.href = ClientEnv.gamePath(gameId);
  }

  render() {
    const pending = this.view?.incoming.length ?? 0;
    const badge = pending + this.lobbies.length;
    return html`
      <div class="fixed left-3 bottom-3 z-[60] select-none font-sans">
        <button
          class="relative flex items-center gap-2 rounded-lg bg-slate-900/90 border border-white/15 px-3 py-2 text-white text-sm font-semibold shadow-lg backdrop-blur hover:bg-slate-800 transition-colors"
          @click=${this.toggle}
        >
          <span aria-hidden="true">👥</span>
          ${translateText("social.button")}
          ${badge > 0
            ? html`<span
                class="ml-1 min-w-5 h-5 px-1 rounded-full bg-malibu-blue text-[11px] leading-5 text-center text-slate-900 font-bold"
                >${badge}</span
              >`
            : nothing}
        </button>
        ${this.open ? this.renderPanel() : nothing}
      </div>
    `;
  }

  private renderPanel() {
    return html`
      <div
        class="absolute left-0 bottom-12 w-[340px] max-w-[calc(100vw-24px)] max-h-[70vh] flex flex-col rounded-xl bg-slate-900/95 border border-white/15 shadow-2xl backdrop-blur text-white overflow-hidden"
      >
        <div class="flex border-b border-white/10 text-sm">
          ${this.renderTab("games", "social.tab_games", this.lobbies.length)}
          ${this.renderTab("ranks", "social.tab_ranks", 0)}
          ${this.renderTab(
            "friends",
            "social.tab_friends",
            this.view?.incoming.length ?? 0,
          )}
        </div>
        <div class="p-3 overflow-y-auto flex flex-col gap-3">
          ${this.error
            ? html`<div
                class="rounded-md bg-red-500/15 border border-red-400/30 px-2 py-1 text-xs text-red-200"
              >
                ${this.error}
              </div>`
            : nothing}
          ${this.notice
            ? html`<div
                class="rounded-md bg-emerald-500/15 border border-emerald-400/30 px-2 py-1 text-xs text-emerald-200"
              >
                ${this.notice}
              </div>`
            : nothing}
          ${this.tab === "games"
            ? this.renderGames()
            : this.tab === "ranks"
              ? this.renderRanks()
              : this.renderFriends()}
        </div>
      </div>
    `;
  }

  private renderTab(tab: Tab, key: string, count: number) {
    const active = this.tab === tab;
    return html`<button
      class="flex-1 py-2 font-semibold uppercase tracking-wide transition-colors border-b-2 ${active
        ? "text-white border-sky-400 bg-white/5"
        : "text-white/50 border-transparent hover:text-white"}"
      @click=${() => {
        this.tab = tab;
        this.error = null;
        this.notice = null;
        void this.refresh();
      }}
    >
      ${translateText(key)}${count > 0 ? ` (${count})` : ""}
    </button>`;
  }

  private renderRanks() {
    const p = this.profile;
    return html`
      ${this.user && p
        ? html`<div
            class="flex items-center justify-between rounded-lg bg-white/5 border border-white/10 px-3 py-2"
          >
            <div>
              <div class="text-xs text-white/50">
                ${translateText("social.your_rating")}
              </div>
              <div class="text-2xl font-bold text-sky-300">${p.rating}</div>
            </div>
            <div class="text-right text-xs text-white/60">
              ${translateText("social.record", {
                wins: p.wins,
                games: p.games,
              })}
            </div>
          </div>`
        : html`<p class="text-xs text-white/60">
            ${translateText("social.ranks_login")}
          </p>`}
      <div class="flex flex-col gap-0.5">
        <div class="text-xs uppercase tracking-wide text-white/50">
          ${translateText("social.leaderboard")}
        </div>
        ${this.leaderboard.length === 0
          ? html`<p class="text-sm text-white/60">
              ${translateText("social.no_ranks")}
            </p>`
          : this.leaderboard.map(
              (e, i) => html`<div
                class="flex items-center gap-2 rounded px-2 py-0.5 text-sm ${e.username ===
                this.user?.username
                  ? "bg-sky-400/15"
                  : ""}"
              >
                <span class="w-6 text-right text-white/40">${i + 1}</span>
                <span class="flex-1 truncate">${e.username}</span>
                <span class="text-xs text-white/50">${e.wins}/${e.games}</span>
                <span class="w-12 text-right font-semibold">${e.rating}</span>
              </div>`,
            )}
      </div>
      ${p && p.matches.length > 0
        ? html`<div class="flex flex-col gap-0.5">
            <div class="text-xs uppercase tracking-wide text-white/50">
              ${translateText("social.recent")}
            </div>
            ${p.matches.map(
              (m) => html`<div class="flex items-center gap-2 text-xs">
                <span
                  class="w-10 font-bold ${m.won
                    ? "text-emerald-300"
                    : "text-red-300"}"
                  >${translateText(m.won ? "social.win" : "social.loss")}</span
                >
                <span class="flex-1 truncate text-white/70"
                  >${m.map} · ${m.mode} · ${m.players}
                  ${translateText("social.players")}</span
                >
                <span class="${m.delta >= 0 ? "text-emerald-300" : "text-red-300"}"
                  >${m.delta >= 0 ? "+" : ""}${m.delta}</span
                >
              </div>`,
            )}
          </div>`
        : nothing}
    `;
  }

  private renderGames() {
    if (this.lobbies.length === 0) {
      return html`<p class="text-sm text-white/60">
        ${translateText("social.no_games")}
      </p>`;
    }
    return html`${this.lobbies.map(
      (l) => html`
        <div
          class="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2"
        >
          <div class="flex-1 min-w-0">
            <div class="font-semibold truncate">
              ${translateText("social.hosted_by", { name: l.host })}
            </div>
            <div class="text-xs text-white/60 truncate">
              ${[
                l.map,
                l.gameMode,
                l.playerCount !== null
                  ? `${l.playerCount}${l.maxPlayers ? "/" + l.maxPlayers : ""} ${translateText("social.players")}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <button
            class="shrink-0 rounded-md bg-malibu-blue px-3 py-1 text-sm font-bold text-slate-900 hover:brightness-110"
            @click=${() => this.join(l.gameId)}
          >
            ${translateText("social.join")}
          </button>
        </div>
      `,
    )}`;
  }

  private renderFriends() {
    if (!this.user) return this.renderAuth();
    const v = this.view;
    return html`
      <div class="flex items-center justify-between text-sm">
        <span class="text-white/70"
          >${translateText("social.signed_in_as")}
          <b class="text-white">${this.user.username}</b></span
        >
        <button
          class="text-xs text-white/50 hover:text-white underline"
          @click=${() => void this.run(logout)}
        >
          ${translateText("social.logout")}
        </button>
      </div>
      <form class="flex gap-2" @submit=${this.submitFriend}>
        <input
          name="friend"
          autocomplete="off"
          maxlength="16"
          placeholder=${translateText("social.add_placeholder")}
          class="flex-1 min-w-0 rounded-md bg-black/30 border border-white/15 px-2 py-1 text-sm outline-none focus:border-malibu-blue"
        />
        <button
          class="rounded-md bg-white/10 px-3 py-1 text-sm font-semibold hover:bg-white/20"
          ?disabled=${this.busy}
        >
          ${translateText("social.add")}
        </button>
      </form>
      ${v && v.incoming.length > 0
        ? html`<div class="flex flex-col gap-1">
            <div class="text-xs uppercase tracking-wide text-white/50">
              ${translateText("social.requests")}
            </div>
            ${v.incoming.map(
              (u) => html`<div
                class="flex items-center gap-2 rounded-md bg-amber-400/10 border border-amber-300/20 px-2 py-1"
              >
                <span class="flex-1 truncate">${u.username}</span>
                <button
                  class="rounded bg-emerald-500 px-2 text-xs font-bold text-slate-900"
                  @click=${() => void this.run(() => acceptFriend(u.id))}
                >
                  ${translateText("social.accept")}
                </button>
                <button
                  class="rounded bg-white/10 px-2 text-xs"
                  @click=${() => void this.run(() => removeFriend(u.id))}
                >
                  ${translateText("social.decline")}
                </button>
              </div>`,
            )}
          </div>`
        : nothing}
      <div class="flex flex-col gap-1">
        <div class="text-xs uppercase tracking-wide text-white/50">
          ${translateText("social.friends")}
        </div>
        ${!v || v.friends.length === 0
          ? html`<p class="text-sm text-white/60">
              ${translateText("social.no_friends")}
            </p>`
          : v.friends.map((f) => this.renderFriend(f))}
      </div>
      ${v && v.outgoing.length > 0
        ? html`<div class="text-xs text-white/50">
            ${translateText("social.pending", {
              names: v.outgoing.map((u) => u.username).join(", "),
            })}
          </div>`
        : nothing}
    `;
  }

  private renderFriend(f: Friend) {
    const dot = {
      game: "bg-red-400",
      lobby: "bg-amber-300",
      online: "bg-emerald-400",
      offline: "bg-white/25",
    }[f.status];
    const action =
      f.gameId === null
        ? null
        : f.status === "lobby"
          ? "social.join"
          : f.status === "game"
            ? "social.spectate"
            : null;
    return html`<div
      class="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white/5"
    >
      <span class="w-2 h-2 rounded-full ${dot}"></span>
      <span class="flex-1 min-w-0">
        <span class="block truncate font-medium">${f.username}</span>
        <span class="block text-[11px] text-white/50"
          >${translateText(`social.status_${f.status}`)}</span
        >
      </span>
      ${action
        ? html`<button
            class="rounded-md bg-malibu-blue px-2 py-0.5 text-xs font-bold text-slate-900 hover:brightness-110"
            @click=${() => this.join(f.gameId!)}
          >
            ${translateText(action)}
          </button>`
        : nothing}
      <button
        class="hidden group-hover:block text-white/40 hover:text-red-300 text-xs"
        title=${translateText("social.remove")}
        @click=${() => void this.run(() => removeFriend(f.id))}
      >
        ✕
      </button>
    </div>`;
  }

  private renderAuth() {
    const isRegister = this.authMode === "register";
    return html`
      <p class="text-sm text-white/70">${translateText("social.auth_intro")}</p>
      <form class="flex flex-col gap-2" @submit=${this.submitAuth}>
        <input
          name="username"
          autocomplete="username"
          maxlength="16"
          required
          placeholder=${translateText("social.username")}
          class="rounded-md bg-black/30 border border-white/15 px-2 py-1.5 text-sm outline-none focus:border-malibu-blue"
        />
        <input
          name="password"
          type="password"
          autocomplete=${isRegister ? "new-password" : "current-password"}
          minlength="6"
          maxlength="72"
          required
          placeholder=${translateText("social.password")}
          class="rounded-md bg-black/30 border border-white/15 px-2 py-1.5 text-sm outline-none focus:border-malibu-blue"
        />
        ${isRegister
          ? html`<p class="text-[11px] text-white/50">
              ${translateText("social.register_hint")}
            </p>`
          : nothing}
        <button
          class="rounded-md bg-malibu-blue py-1.5 text-sm font-bold text-slate-900 hover:brightness-110 disabled:opacity-50"
          ?disabled=${this.busy}
        >
          ${translateText(isRegister ? "social.register" : "social.login")}
        </button>
      </form>
      <button
        class="text-xs text-white/60 hover:text-white underline self-start"
        @click=${() => {
          this.authMode = isRegister ? "login" : "register";
          this.error = null;
        }}
      >
        ${translateText(
          isRegister ? "social.have_account" : "social.need_account",
        )}
      </button>
    `;
  }
}
