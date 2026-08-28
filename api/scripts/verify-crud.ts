import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

async function main() {
  const chairEmail = `chair-${Date.now()}@example.com`
  const naEmail = `na-${Date.now()}@example.com`

  // User: create + read
  const chair = await prisma.user.create({
    data: { email: chairEmail, name: 'Test Chair', initials: 'TC', roles: ['Chair'] },
  })
  const networkAdvisor = await prisma.user.create({
    data: { email: naEmail, name: 'Test NA', initials: 'TN', roles: ['NetworkAdvisor'] },
  })
  assert((await prisma.user.findUniqueOrThrow({ where: { email: chairEmail } })).name === 'Test Chair', 'User read')

  // Group: create + read, linked to both users
  const group = await prisma.group.create({
    data: {
      egnGroupId: 'EGN-TEST-1',
      partnerCode: 'DK',
      country: 'Denmark',
      name: 'Test Group',
      groupProfile: 'Group profile text',
      memberProfile: 'Member profile text',
      companiesProfile: 'Companies profile text',
      chairEmail: chair.email,
      networkAdvisorEmail: networkAdvisor.email,
    },
  })
  assert(
    (await prisma.group.findUniqueOrThrow({ where: { id: group.id } })).lifecycleStatus === 'Imported',
    'Group defaults to Imported',
  )

  // Group: update (lifecycle transition)
  const launchedGroup = await prisma.group.update({
    where: { id: group.id },
    data: { lifecycleStatus: 'Launched' },
  })
  assert(launchedGroup.lifecycleStatus === 'Launched', 'Group update')

  // DnaVersion: create + read
  const dnaVersion = await prisma.dnaVersion.create({
    data: {
      groupId: group.id,
      versionNumber: 1,
      content: { groupProfile: 'v1', memberProfile: 'v1', companiesProfile: 'v1' },
      author: 'Ai',
      score: 4,
      scoreStage: 'Imported',
    },
  })
  assert(
    (await prisma.dnaVersion.findUniqueOrThrow({ where: { id: dnaVersion.id } })).versionNumber === 1,
    'DnaVersion read',
  )

  // Comment: create + read
  const comment = await prisma.comment.create({
    data: {
      groupId: group.id,
      dnaVersionId: dnaVersion.id,
      field: 'GroupProfile',
      author: 'NetworkAdvisor',
      text: 'Looks good, one suggestion.',
    },
  })
  assert((await prisma.comment.findUniqueOrThrow({ where: { id: comment.id } })).text.length > 0, 'Comment read')

  // Event: create + read
  const event = await prisma.event.create({
    data: { groupId: group.id, type: 'Launch', actorEmail: chair.email },
  })
  assert((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).type === 'Launch', 'Event read')

  // AiConversationTurn: create + read
  const turn = await prisma.aiConversationTurn.create({
    data: {
      groupId: group.id,
      field: 'GroupProfile',
      chairEmail: chair.email,
      role: 'Chair',
      messageText: 'Make this sharper',
      outcome: 'None',
    },
  })
  assert(
    (await prisma.aiConversationTurn.findUniqueOrThrow({ where: { id: turn.id } })).role === 'Chair',
    'AiConversationTurn read',
  )

  // Delete, child-to-parent order (no cascade configured)
  await prisma.aiConversationTurn.delete({ where: { id: turn.id } })
  await prisma.event.delete({ where: { id: event.id } })
  await prisma.comment.delete({ where: { id: comment.id } })
  await prisma.dnaVersion.delete({ where: { id: dnaVersion.id } })
  await prisma.group.delete({ where: { id: group.id } })
  await prisma.user.delete({ where: { email: chair.email } })
  await prisma.user.delete({ where: { email: networkAdvisor.email } })

  assert((await prisma.group.findUnique({ where: { id: group.id } })) === null, 'Group deleted')

  console.log('CRUD verification passed for User, Group, DnaVersion, Comment, Event, AiConversationTurn.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
