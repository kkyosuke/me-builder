import { generateOpenApiDocument } from "../src/app";

const document = await generateOpenApiDocument();
const output = new URL("../openapi.json", import.meta.url);

await Bun.write(output, `${JSON.stringify(document, null, 2)}\n`);
