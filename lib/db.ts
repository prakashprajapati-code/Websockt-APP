import { Sequelize } from "sequelize";
import pg from 'pg'

const globalForDb = globalThis as unknown as {
  sequelize: Sequelize | undefined;
};

function createSequelize() {
  return new Sequelize(
    process.env.DB_NAME || "authapp",
    process.env.DB_USER || "root",
    process.env.DB_PASS || "password",
    {
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT) || 5434,
      dialect: (process.env.DB_DIALECT as "postgres") || "postgres",
      logging: false,
      dialectModule: pg
    }
  );
}

export const sequelize = globalForDb.sequelize ?? createSequelize();

if (process.env.NODE_ENV !== "production") {
  globalForDb.sequelize = sequelize;
}
