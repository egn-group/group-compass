// The generated Prisma client lives outside node_modules (see
// prisma/schema.prisma's `output` and the comment there) specifically so
// Azure's Oryx build service can't clobber it. That means it can't be
// reached via the normal `@prisma/client` package resolution, and a plain
// relative import (`../generated/prisma-client`) would resolve to a
// different actual location depending on whether the CALLING file is
// running as compiled dist/ output (deployed, and every local
// `node dist/...` script) or as .ts source directly (vitest) — tsc mirrors
// api/**/*.ts into api/dist/api/**/*.js, but Prisma's generated output
// isn't part of that mirroring, so the same relative path string would
// need a different number of `../` in each case.
//
// process.cwd() sidesteps that: every entry point in this project (the
// deployed Azure Functions host, `node dist/api/scripts/*.js`, and vitest)
// is always invoked with api/'s own root as the working directory, so a
// cwd-relative path is stable regardless of which of those is asking.
//
// This is the ONLY file that should import the generated client directly —
// everywhere else, import PrismaClient (and any model types) from here.
import path from 'path'
import type * as PrismaClientModule from '../generated/prisma-client'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const generated = require(path.join(process.cwd(), 'generated', 'prisma-client')) as typeof PrismaClientModule

export const PrismaClient = generated.PrismaClient
export type { User, Group } from '../generated/prisma-client'
