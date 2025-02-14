import { Collection } from "discord.js";
import { readdirSync } from "fs";
import Client from "$core/Client";
import Logger from "$core/utils/Logger";
import "dotenv/config";
import Context from "$core/contexts/Context";

export default class ContextManager {

  public readonly contexts: Collection<string, Context> = new Collection();

  constructor() {
    this.load().then(() => this.listener());
  }

  private async load() : Promise<void> {
    const files = readdirSync(`${__dirname}/list`).filter(file => file.endsWith(".ts") || file.endsWith(".js"));

    let i = 0;
    for (const file of files) {
      const dynamicImport = await import(`./list/${file}`);

      const context: Context = new dynamicImport.default();
      this.contexts.set(context.name, context);
      i++;
    }

    Logger.info(`${i} context(s) loaded`);
  }

  private async listener() : Promise<void> {
    Client.instance.on("interactionCreate", async interaction => {
      if (!interaction.isUserContextMenuCommand() && !interaction.isMessageContextMenuCommand()) return;

      const context = this.contexts.get(interaction.commandName);
      if (context) context.execute(interaction);
    });
  }

  /**
    * Register the context commands (use it when the client is ready)
  */
  public async register() : Promise<void> {
    for (const command of this.contexts.values()) {
      this.contexts.map(context => context.context.toJSON());
      await Client.instance.application?.commands.create(command.context);
    }

    Logger.info("Successfully registered application contexts");
  }

}