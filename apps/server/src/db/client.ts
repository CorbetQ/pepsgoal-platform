import postgres from 'postgres';
import { env } from '../env.js';

/**
 * Connexion PostgreSQL utilisée par toutes les routes (requêtes paramétrées, jamais de concaténation).
 * Drizzle sert uniquement à décrire le schéma et générer les migrations (`drizzle-kit`) : ne pas envelopper
 * cette connexion avec `drizzle()`, qui remplace ses convertisseurs JSON et dates et casserait ces requêtes.
 */
export const sql = postgres(env.DATABASE_URL, { max: env.DB_POOL_MAX, prepare: env.DB_PREPARE, idle_timeout: 30, transform: { undefined: null } });

export type Sql = typeof sql;
export type Tx = postgres.TransactionSql;
