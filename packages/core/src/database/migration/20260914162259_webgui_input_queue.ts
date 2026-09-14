import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260914162259_webgui_input_queue",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_input_queue_v1\` (
          \`session_id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 0 NOT NULL,
          \`paused\` integer DEFAULT false NOT NULL,
          \`owner\` text NOT NULL,
          \`next_id\` text,
          CONSTRAINT \`fk_session_input_queue_v1_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_queued_input_v1\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`sequence\` integer NOT NULL,
          \`delivery\` text NOT NULL,
          \`state\` text NOT NULL,
          \`input\` text NOT NULL,
          \`prepared\` text,
          CONSTRAINT \`fk_session_queued_input_v1_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_queued_input_v1_pending_idx\` ON \`session_queued_input_v1\` (\`session_id\`,\`state\`,\`sequence\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
