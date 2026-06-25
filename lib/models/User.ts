import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../../lib/db";

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<number>;
  declare email: string;
  declare password: string;
  declare username: string;
  declare publickey: string | null;
  declare olm_identity_key: string | null;
}

User.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    username: { type: DataTypes.STRING, allowNull: false },
    publickey: { type: DataTypes.STRING, allowNull: true },
   olm_identity_key: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    modelName: "usermodel",
  }
);
