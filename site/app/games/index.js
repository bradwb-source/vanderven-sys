import { mountAsteroids } from "./asteroids.js";
import { mountMissileCommand } from "./missile-command.js";
import { mountPokemonRed } from "./pokemon-red.js";
import { mountSpaceInvaders } from "./space-invaders.js";

const registry = {
  asteroids: mountAsteroids,
  "missile-command": mountMissileCommand,
  "pokemon-red": mountPokemonRed,
  "space-invaders": mountSpaceInvaders,
};

export async function mountGame(id, root) {
  const mount = registry[id];
  if (!mount) throw new Error(`Unknown game: ${id}`);
  if (!root) throw new Error("Missing game stage.");
  return mount(root);
}

export const gameIds = Object.keys(registry);
