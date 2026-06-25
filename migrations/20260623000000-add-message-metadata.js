'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('messagetables', 'senderkey', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('messagetables', 'messagetype', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('messagetables', 'senderkey');
    await queryInterface.removeColumn('messagetables', 'messagetype');
  },
};
