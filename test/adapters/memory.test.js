import { itBehavesLikeAnAdapter } from "./conformance.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";

itBehavesLikeAnAdapter("memory", () => new MemoryAdapter());
