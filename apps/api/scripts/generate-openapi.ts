import { generateSpecs } from "hono-openapi";
import { app } from "../src/app";
import { openApiOptions } from "../src/openapi";

const document = await generateSpecs(app, openApiOptions);
const output = new URL("../openapi.json", import.meta.url);

await Bun.write(output, `${JSON.stringify(document, null, 2)}\n`);
