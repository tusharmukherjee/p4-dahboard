import { neon } from "@neondatabase/serverless";

let vocabularyDatabase: ReturnType<typeof neon> | null = null;

export function getVocabularyDatabase(): ReturnType<typeof neon> {
    if (!vocabularyDatabase) {
        const databaseUrl = process.env.VOCAB_DB_URL;
        if (!databaseUrl) {
            throw new Error("VOCAB_DB_URL is not configured");
        }

        // Vocabulary has its own database, separate from users and OAuth tokens.
        vocabularyDatabase = neon(databaseUrl);
    }

    return vocabularyDatabase;
}
