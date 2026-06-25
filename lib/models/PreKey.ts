import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "@/lib/db";

export class PreKey extends Model<InferAttributes<PreKey>, InferCreationAttributes<PreKey>> {
  declare id: CreationOptional<number>;
  declare userid: number;
  declare type: "signed" | "one-time";
  declare key_id: string;
  declare publickey: string;
  declare signature: string | null;
  declare used: CreationOptional<boolean>;
}

PreKey.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userid: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    key_id: { type: DataTypes.STRING, allowNull: false },
    publickey: { type: DataTypes.STRING, allowNull: false },
    signature: { type: DataTypes.STRING, allowNull: true },
    used: { type: DataTypes.BOOLEAN, defaultValue: false },
  },
  {
    sequelize,
    modelName: "prekey",
    tableName: "prekeys",
  }
);
