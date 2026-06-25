import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { sequelize } from "../../lib/db";

export class Message extends Model<InferAttributes<Message>, InferCreationAttributes<Message>> {
  declare id: CreationOptional<number>;
  declare message: string;
  declare senderid: number;
  declare receiverid: number;
  declare time: CreationOptional<Date>;
  declare status: CreationOptional<string>;
  declare senderkey: CreationOptional<string | null>;
  declare messagetype: CreationOptional<number | null>;
}



Message.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    message: { type: DataTypes.STRING, allowNull: false },
    senderid: { type: DataTypes.INTEGER, allowNull: false },
    receiverid: { type: DataTypes.INTEGER, allowNull: false },
    time: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    status: { type: DataTypes.STRING, defaultValue: "sent" },
    senderkey: { type: DataTypes.STRING, allowNull: true },
    messagetype: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    modelName: "messagetable",
    tableName: "messagetables",
  }
);
