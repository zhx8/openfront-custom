import {
  BuildableUnit,
  BuildMenus,
  Gold,
  PlayerBuildableUnitType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { ToggleStructureEvent } from "../../InputHandler";
import { UIState } from "../../UIState";
import { UserSettings } from "../../UserSettings";
import { translateText } from "../../Utils";
import { GameView } from "../../view";
import {
  airfieldIcon,
  atomBombIcon,
  bomberIcon,
  fighterIcon,
  cityIcon,
  defensePostIcon,
  factoryIcon,
  goldCoinIcon,
  hydrogenBombIcon,
  assaultShipIcon,
  mirvIcon,
  paratrooperIcon,
  missileSiloIcon,
  portIcon,
  samLauncherIcon,
  warshipIcon,
} from "../HotbarIcons";
import { TutorialHighlight, TutorialHighlightEvent } from "../Tutorial";

@customElement("unit-display")
export class UnitDisplay extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private playerBuildables: BuildableUnit[] | null = null;
  private keybinds: Record<string, { value: string; key: string }> = {};
  private _cities = 0;
  private _warships = 0;
  private _factories = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _defensePost = 0;
  private _samLauncher = 0;
  private _airfield = 0;
  private _fighters = 0;
  private allDisabled = false;
  private _hoveredUnit: PlayerBuildableUnitType | null = null;
  private tutorialHighlight: PlayerBuildableUnitType | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    const config = this.game.config();
    const userSettings = new UserSettings();

    this.keybinds = userSettings.parsedUserKeybinds();

    this.allDisabled = BuildMenus.types.every((u) => config.isUnitDisabled(u));

    const highlightUnits: Partial<
      Record<TutorialHighlight, PlayerBuildableUnitType>
    > = {
      city: UnitType.City,
      port: UnitType.Port,
      defense_post: UnitType.DefensePost,
      factory: UnitType.Factory,
      warship: UnitType.Warship,
      silo: UnitType.MissileSilo,
      atom: UnitType.AtomBomb,
      hydrogen: UnitType.HydrogenBomb,
      mirv: UnitType.MIRV,
      sam: UnitType.SAMLauncher,
    };
    this.eventBus.on(TutorialHighlightEvent, (e) => {
      this.tutorialHighlight = (e.target && highlightUnits[e.target]) ?? null;
      this.requestUpdate();
    });
    this.requestUpdate();
  }

  private cost(item: UnitType): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item) {
        return bu.cost;
      }
    }
    return 0n;
  }

  private canBuild(item: UnitType): boolean {
    if (this.game?.config().isUnitDisabled(item)) return false;
    const player = this.game?.myPlayer();
    switch (item) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.MissileSilo).length ?? 0) > 0
        );
      case UnitType.Warship:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.Port).length ?? 0) > 0
        );
      case UnitType.Bomber:
      case UnitType.Paratrooper:
      case UnitType.Fighter:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.Airfield).length ?? 0) > 0
        );
      default:
        return this.cost(item) <= (player?.gold() ?? 0n);
    }
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    player.buildables(undefined, BuildMenus.types).then((buildables) => {
      this.playerBuildables = buildables;
    });
    this._cities = player.totalUnitLevels(UnitType.City);
    this._missileSilo = player.totalUnitLevels(UnitType.MissileSilo);
    this._port = player.totalUnitLevels(UnitType.Port);
    this._defensePost = player.totalUnitLevels(UnitType.DefensePost);
    this._samLauncher = player.totalUnitLevels(UnitType.SAMLauncher);
    this._factories = player.totalUnitLevels(UnitType.Factory);
    this._warships = player.totalUnitLevels(UnitType.Warship);
    this._airfield = player.totalUnitLevels(UnitType.Airfield);
    this._fighters = player.units(UnitType.Fighter).length;
    this.requestUpdate();
  }

  render() {
    const myPlayer = this.game?.myPlayer();
    if (
      !this.game ||
      !myPlayer ||
      this.game.inSpawnPhase() ||
      !myPlayer.isAlive()
    ) {
      return null;
    }
    if (this.allDisabled) {
      return null;
    }

    // Two rows so every button keeps its size in the 500px HUD column:
    // things you build at home, then units and strikes you send out.
    const buildings = [
      [
        cityIcon,
        this._cities,
        UnitType.City,
        "city",
        this.keybinds["buildCity"]?.key ?? "1",
      ],
      [
        factoryIcon,
        this._factories,
        UnitType.Factory,
        "factory",
        this.keybinds["buildFactory"]?.key ?? "2",
      ],
      [
        portIcon,
        this._port,
        UnitType.Port,
        "port",
        this.keybinds["buildPort"]?.key ?? "3",
      ],
      [
        defensePostIcon,
        this._defensePost,
        UnitType.DefensePost,
        "defense_post",
        this.keybinds["buildDefensePost"]?.key ?? "4",
      ],
      [
        missileSiloIcon,
        this._missileSilo,
        UnitType.MissileSilo,
        "missile_silo",
        this.keybinds["buildMissileSilo"]?.key ?? "5",
      ],
      [
        samLauncherIcon,
        this._samLauncher,
        UnitType.SAMLauncher,
        "sam_launcher",
        this.keybinds["buildSamLauncher"]?.key ?? "6",
      ],
      [
        airfieldIcon,
        this._airfield,
        UnitType.Airfield,
        "airfield",
        this.keybinds["buildAirfield"]?.key ?? "H",
      ],
    ] as const;
    const forces = [
      [
        warshipIcon,
        this._warships,
        UnitType.Warship,
        "warship",
        this.keybinds["buildWarship"]?.key ?? "7",
      ],
      [
        assaultShipIcon,
        null,
        UnitType.AssaultShip,
        "assault_ship",
        this.keybinds["buildAssaultShip"]?.key ?? "O",
      ],
      [
        fighterIcon,
        this._fighters,
        UnitType.Fighter,
        "fighter",
        this.keybinds["buildFighter"]?.key ?? "V",
      ],
      [
        bomberIcon,
        null,
        UnitType.Bomber,
        "bomber",
        this.keybinds["buildBomber"]?.key ?? "J",
      ],
      [
        paratrooperIcon,
        null,
        UnitType.Paratrooper,
        "paratrooper",
        this.keybinds["buildParatrooper"]?.key ?? "I",
      ],
      [
        atomBombIcon,
        null,
        UnitType.AtomBomb,
        "atom_bomb",
        this.keybinds["buildAtomBomb"]?.key ?? "8",
      ],
      [
        hydrogenBombIcon,
        null,
        UnitType.HydrogenBomb,
        "hydrogen_bomb",
        this.keybinds["buildHydrogenBomb"]?.key ?? "9",
      ],
      [
        mirvIcon,
        null,
        UnitType.MIRV,
        "mirv",
        this.keybinds["buildMIRV"]?.key ?? "0",
      ],
    ] as const;
    const row = (
      label: string,
      items: typeof buildings | typeof forces,
    ) => html`
      <div class="flex items-center gap-1.5 w-full">
        <div
          class="w-12 shrink-0 text-[9px] font-bold uppercase tracking-wider text-white/40 text-right leading-tight"
        >
          ${translateText(label)}
        </div>
        <div class="flex flex-1 justify-start gap-1">
          ${items.map(([icon, n, type, key, hotkey]) =>
            this.renderUnitItem(icon, n, type, key, hotkey),
          )}
        </div>
      </div>
    `;

    return html`
      <div
        class="border-t border-white/10 px-1.5 py-1 w-full flex flex-col gap-1"
      >
        ${row("unit_bar.build", buildings)} ${row("unit_bar.forces", forces)}
      </div>
    `;
  }

  private renderUnitItem(
    icon: string,
    number: number | null,
    unitType: PlayerBuildableUnitType,
    structureKey: string,
    hotkey: string,
  ) {
    if (this.game.config().isUnitDisabled(unitType)) {
      return html``;
    }
    const selected = this.uiState.ghostStructure === unitType;
    const hovered = this._hoveredUnit === unitType;
    const displayHotkey = hotkey
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();

    return html`
      <div
        class="flex flex-col items-center relative"
        @mouseenter=${() => {
          this._hoveredUnit = unitType;
          this.requestUpdate();
        }}
        @mouseleave=${() => {
          this._hoveredUnit = null;
          this.requestUpdate();
        }}
      >
        ${hovered
          ? html`
              <div
                class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-gray-200 text-center w-max text-xs bg-gray-800/90 backdrop-blur-xs rounded-sm p-1 z-[100] shadow-lg pointer-events-none"
              >
                <div class="font-bold text-sm mb-1">
                  ${translateText(
                    "unit_type." + structureKey,
                  )}${` [${displayHotkey}]`}
                </div>
                <div class="p-2">
                  ${translateText("build_menu.desc." + structureKey)}
                </div>
                ${unitType === UnitType.Warship
                  ? html`<div
                      class="mt-1 px-2 py-1 text-[10px] text-cyan-300 border-t border-white/10"
                    >
                      ⇧ ${translateText("build_menu.warship_shift_hint")}
                    </div>`
                  : null}
                <div class="flex items-center justify-center gap-1">
                  <img src=${goldCoinIcon} width="13" height="13" />
                  <span class="text-yellow-300"
                    >${renderNumber(this.cost(unitType))}</span
                  >
                </div>
              </div>
            `
          : null}
        <div
          class="${this.canBuild(unitType)
            ? ""
            : "opacity-40"} relative w-[46px] h-9 border rounded-md flex items-center justify-center cursor-pointer transition-colors
             ${selected
            ? "border-sky-400 bg-sky-400/20 ring-1 ring-sky-400"
            : "border-white/15 bg-black/20 hover:bg-white/10"}
             text-white
             ${this.tutorialHighlight === unitType ? "tutorial-highlight" : ""}"
          @click=${() => {
            if (selected) {
              this.uiState.ghostStructure = null;
            } else if (this.canBuild(unitType)) {
              this.uiState.ghostStructure = unitType;
            }
            this.requestUpdate();
          }}
          @mouseenter=${() => {
            switch (unitType) {
              case UnitType.AtomBomb:
              case UnitType.HydrogenBomb:
                this.eventBus?.emit(
                  new ToggleStructureEvent([
                    UnitType.MissileSilo,
                    UnitType.SAMLauncher,
                  ]),
                );
                break;
              case UnitType.Warship:
                this.eventBus?.emit(new ToggleStructureEvent([UnitType.Port]));
                break;
              case UnitType.Bomber:
              case UnitType.Paratrooper:
              case UnitType.Fighter:
                this.eventBus?.emit(
                  new ToggleStructureEvent([UnitType.Airfield]),
                );
                break;
              default:
                this.eventBus?.emit(new ToggleStructureEvent([unitType]));
            }
          }}
          @mouseleave=${() =>
            this.eventBus?.emit(new ToggleStructureEvent(null))}
        >
          <span
            class="absolute top-0 left-0.5 text-[9px] leading-none text-white/45"
            >${displayHotkey}</span
          >
          <img src=${icon} alt=${structureKey} class="size-5" />
          ${number !== null && number > 0
            ? html`<span
                class="absolute -bottom-1 -right-1 min-w-4 px-0.5 rounded bg-slate-700 border border-white/20 text-[9px] leading-3.5 text-center"
                >${renderNumber(number)}</span
              >`
            : null}
        </div>
      </div>
    `;
  }
}
