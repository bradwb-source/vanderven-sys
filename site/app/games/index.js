import { mountAsteroids } from "./asteroids.js";
import { mountBreakout } from "./breakout.js";
import { mountMissileCommand } from "./missile-command.js";
import { mountPacMan } from "./pac-man.js";
import { mountPokemonRed } from "./pokemon-red.js";
import { mountSnake } from "./snake.js";
import { mountSpaceInvaders } from "./space-invaders.js";
import { mountTetris } from "./tetris.js";

const registry = {
  asteroids: mountAsteroids,
  breakout: mountBreakout,
  "missile-command": mountMissileCommand,
  "pac-man": mountPacMan,
  "pokemon-red": mountPokemonRed,
  snake: mountSnake,
  "space-invaders": mountSpaceInvaders,
  tetris: mountTetris,
};

export async function mountGame(id, root) {
  const mount = registry[id];
  if (!mount) throw new Error(`Unknown game: ${id}`);
  if (!root) throw new Error("Missing game stage.");
  return mount(root);
}

export const gameIds = Object.keys(registry);
