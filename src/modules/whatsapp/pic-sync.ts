import { prisma } from "@/lib/prisma";
import { waManager } from "./manager";
import { logger } from "@/lib/logger";

// Sincronização automática e leve de fotos de perfil.
// - Só busca quem está SEM foto (profilePic nulo), 3 por ciclo a cada 2 min.
// - Só guarda a URL (texto), nenhuma imagem é baixada.
// - Pausa de 5s entre buscas para não forçar o chip.
// - Quem não tem foto (erro) entra na lista de ignorados até reiniciar.
const BATCH = 3;
const INTERVAL_MS = 2 * 60 * 1000;
const PAUSE_MS = 5 * 1000;

const semFoto = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ciclo() {
    try {
        const sessions = await prisma.session.findMany({ select: { id: true, sessionId: true } });
        for (const s of sessions) {
            const instance = waManager.getInstance(s.sessionId);
            if (!instance?.socket || (instance as any).status !== "CONNECTED") continue;

            const pendentes = await prisma.contact.findMany({
                where: {
                    sessionId: s.id,
                    profilePic: null,
                    NOT: [{ jid: { endsWith: "@g.us" } }, { jid: { endsWith: "@broadcast" } }, { jid: { endsWith: "@newsletter" } }],
                },
                select: { jid: true },
                take: BATCH,
            });

            for (const c of pendentes) {
                const chave = `${s.sessionId}:${c.jid}`;
                if (semFoto.has(chave)) continue;
                try {
                    const url = await (instance.socket as any).profilePictureUrl(c.jid, "image");
                    if (url) {
                        await prisma.contact.updateMany({
                            where: { sessionId: s.id, jid: c.jid },
                            data: { profilePic: url },
                        });
                        logger.info("PicSync", `Foto sincronizada (${s.sessionId})`);
                    } else {
                        semFoto.add(chave);
                    }
                } catch {
                    semFoto.add(chave);
                }
                await sleep(PAUSE_MS);
            }
        }
    } catch (e) {
        logger.error("PicSync", "Erro no ciclo:", e);
    }
}

export function startPicSync() {
    logger.info("PicSync", "Sincronização automática de fotos ativada (leve: 3 por ciclo).");
    ciclo();
    setInterval(ciclo, INTERVAL_MS);
}
