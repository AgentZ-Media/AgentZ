import { render } from "solid-js/web";
import { SuiteShell } from "@agentz/kit/shell";
import "@agentz/design/fonts.css";
import "@agentz/design/tokens.css";
import "@agentz/design/components.css";
import "@agentz/kit/styles.css";
import "./fixture.css";
import { createFixtureKv, createFixtureModule, fixturePlatform } from "./module";

const { kv } = createFixtureKv();
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
render(() => <SuiteShell module={createFixtureModule()} platform={fixturePlatform} kv={kv} />, root);
