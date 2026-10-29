import { getVocabularyDatabase } from "../db/vocabularyClient.js";
import { BaseModule } from "./baseModule.js";

interface VocabularyConfig {
    payload?: {
        batchSize?: number;
    };
}

interface VocabularyRow {
    id: number;
    word: string;
    cefr: string;
    definition: string;
    partofspeech: string;
    shortexample: string;
    last_shown_at: Date | string;
}

interface VocabularyWord {
    id: number;
    word: string;
    cefr: string;
    definition: string;
    partOfSpeech: string;
    shortExample: string;
    lastShownAt: string;
}

interface VocabularyData {
    words: VocabularyWord[];
}

export class VocabularyModule extends BaseModule<VocabularyConfig, VocabularyData> {
    readonly id = "vocabulary";
    readonly name = "Vocabulary";

    protected async fetch(config: VocabularyConfig): Promise<VocabularyData> {
        const batchSize = this.getBatchSize(config.payload?.batchSize);
        const sql = getVocabularyDatabase();

        // Rank words inside each CEFR level, then interleave the levels. This
        // gives a mixed batch instead of exhausting one level at a time.
        const rows = await sql`
            WITH ranked_words AS (
                SELECT
                    id,
                    cefr,
                    ROW_NUMBER() OVER (
                        PARTITION BY cefr
                        ORDER BY last_shown_at ASC NULLS FIRST, id ASC
                    ) AS position_in_level,
                    MAX(last_shown_at) OVER (PARTITION BY cefr) AS level_last_shown
                FROM vocabulary
                WHERE cefr IN ('B1', 'B2', 'C1', 'C2')
            ),
            next_word AS (
                SELECT v.id
                FROM vocabulary AS v
                INNER JOIN ranked_words AS ranked ON ranked.id = v.id
                ORDER BY
                    ranked.position_in_level ASC,
                    ranked.level_last_shown ASC NULLS FIRST,
                    CASE ranked.cefr
                        WHEN 'B1' THEN 1
                        WHEN 'B2' THEN 2
                        WHEN 'C1' THEN 3
                        WHEN 'C2' THEN 4
                    END
                LIMIT ${batchSize}
                FOR UPDATE OF v SKIP LOCKED
            )
            UPDATE vocabulary AS v
            SET last_shown_at = NOW()
            FROM next_word
            WHERE v.id = next_word.id
            RETURNING
                v.id,
                v.word,
                v.cefr,
                v.definition,
                v.partofspeech,
                v.shortexample,
                v.last_shown_at
        ` as VocabularyRow[];

        return {
            words: rows.map((row) => ({
                id: row.id,
                word: row.word,
                cefr: row.cefr,
                definition: row.definition,
                partOfSpeech: row.partofspeech,
                shortExample: row.shortexample,
                lastShownAt: row.last_shown_at instanceof Date
                    ? row.last_shown_at.toISOString()
                    : row.last_shown_at,
            })),
        };
    }

    private getBatchSize(batchSize: number | undefined): number {
        if (batchSize === undefined) {
            return 5;
        }
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
            throw new Error("Vocabulary batchSize must be an integer between 1 and 50");
        }

        return batchSize;
    }
}
