import { buildServer } from "./app"
import { getServerConfig, prepareServerDataDirectory } from "./config"

const config = getServerConfig()
const dataDirectoryResult = prepareServerDataDirectory(config)

if (dataDirectoryResult.imported) {
  console.info(
    `Imported legacy development database from ${dataDirectoryResult.sourcePath} to ${dataDirectoryResult.targetPath}`,
  )
}

const app = await buildServer({
  dbPath: config.dbPath,
  logger: true,
  socratesHome: config.socratesHome,
})

try {
  await app.listen({ host: config.host, port: config.port })
  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, "Closing Socrates cleanly")
    try {
      await app.close()
      process.exitCode = 0
    } catch (error) {
      app.log.error(error, "Socrates shutdown failed")
      process.exitCode = 1
    }
  }
  process.once("SIGINT", () => { void shutdown("SIGINT") })
  process.once("SIGTERM", () => { void shutdown("SIGTERM") })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
