import { getUsageButton, simpleEmbed } from "$core/utils/Embed";
import { buildQuestion, AskContextOptions, Locales, BuildQuestionContext, BuildQuestionLanguage } from "$core/utils/Models";
import { prisma } from "$core/utils/Prisma";
import { checkUser, getUser, isPremium } from "$core/utils/User";
import { ask } from "$resources/messages.json";
import { SlashCommandBooleanOption } from "@discordjs/builders";
import { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandStringOption, TextChannel, InteractionReplyOptions } from "discord.js";
import { getLang } from "$core/utils/Message";
import Client from "$core/Client";
import Command from "$core/commands/Command";
import Logger from "$core/utils/Logger";
import dayjs from "dayjs";

export default class Ask extends Command {

  public readonly guildOnly = false;

  public readonly slashCommand = new SlashCommandBuilder()
    .setName("ask")
    .setDescription(ask.command.description["en-US"])
    .setDescriptionLocalizations({ fr: ask.command.description.fr })
    .addStringOption(new SlashCommandStringOption()
      .setName("content")
      .setDescription(ask.command.options.question["en-US"])
      .setDescriptionLocalizations({ fr: ask.command.options.question.fr })
      .setRequired(true))
    .addStringOption(new SlashCommandStringOption()
      .setName("context")
      .setDescription(ask.command.options.context["en-US"])
      .setDescriptionLocalizations({ fr: ask.command.options.context.fr })
      .addChoices(...AskContextOptions.map(c => ({ name: c.name, value: c.value, name_localizations: { fr: c.name_localizations.fr } }))))
    .addStringOption(new SlashCommandStringOption()
      .setName("language")
      .setDescription(ask.command.options.lang["en-US"])
      .setDescriptionLocalizations({ fr: ask.command.options.lang.fr })
      .addChoices(...Locales.map(l => ({ name: l.name, value: l.value }))))
    .addBooleanOption(new SlashCommandBooleanOption()
      .setName("private")
      .setDescription(ask.command.options.private["en-US"])
      .setDescriptionLocalizations({ fr: ask.command.options.private.fr }))
    .setDMPermission(false);

  public async execute(command: ChatInputCommandInteraction): Promise<void> {
    command.deferReply({ ephemeral: command.options.getBoolean("private", false) ?? true });

    const askedAt = dayjs().toDate();
    await checkUser(command.user.id);
    const user = await getUser(command.user.id);
    const isPremiumUser = isPremium(user);

    if (!isPremiumUser) {
      if (user.askUsage <= 0) {
        command.editReply({ embeds: [simpleEmbed(ask.errors.trial[getLang(command.locale)], "error", { f: command.user })] });
        return;
      }
    }

    const question = command.options.getString("content", true);
    const context: BuildQuestionContext = command.options.getString("context", false) ?? "default";
    const language: BuildQuestionLanguage = command.options.getString("language", false) ?? command.locale;
    const finalQuestion = buildQuestion(question, context, language);

    const response = await Client.instance.openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      max_tokens: 2000,
      temperature: 0.9,
      messages: [{
        content: finalQuestion,
        role: "user"
      }]
    });

    await prisma.user.update({
      where: { id: command.user.id },
      data: {
        lastAsked: dayjs().unix().toString(),
        askUsage: {
          decrement: 1
        }
      }
    });

    const text = response.data.choices[0].message?.content ?? "I don't know what to say...";

    const embed = simpleEmbed(text, "normal", {
      f: command.user
    });

    const channel = await command.client.channels.fetch(command.channelId);
    if (!channel || !(channel instanceof TextChannel)) return;

    let replyOptions: InteractionReplyOptions;
    if (!isPremiumUser) {
      replyOptions = {
        embeds: [embed],
        components: [{
          type: 1,
          components: [getUsageButton(user.askUsage - 1)]
        }]
      };
    } else {
      replyOptions = {
        embeds: [embed]
      };
    }

    await command.editReply(replyOptions).then(async() => {
      Logger.request(finalQuestion);

      await prisma.stats.create({
        data: {
          createdAt: dayjs().toDate(),
          guildId: command.guild?.id ?? "DM",
          userId: command.user.id,
          type: "ask"
        }
      });

      await prisma.requests.create({
        data: {
          userId: command.user.id,
          guildName: command.guild?.name ?? "DM",
          channelName: channel.name ?? "DM",
          question: question,
          answer: Buffer.from(text).toString("base64"),
          answeredAt: dayjs().toDate(),
          askedAt: askedAt,
          timestamp: dayjs().unix().toString(),
          options: {
            context: context ?? "default",
            language: language ?? command.locale
          }
        }
      });
    }).catch(async(e) => {
      console.error(e);
      await command.editReply({ embeds: [simpleEmbed(ask.errors.error[getLang(command.locale)], "error", { f: command.user })] });
    });
  }

}