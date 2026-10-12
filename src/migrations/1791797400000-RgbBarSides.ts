import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The monitor bar light has two strips. `join` ties them together (they use `color` and
 * `brightness`); with join off, `color`/`brightness` are the left strip and the right strip
 * uses `rightColor`/`rightBrightness`. Power, mode and colour temperature stay shared.
 */
const NEW_PROPERTIES = {
  join: { type: 'boolean', title: 'Join both sides' },
  rightColor: {
    type: 'string',
    pattern: '^#[0-9a-fA-F]{6}$',
    title: 'Right colour',
  },
  rightBrightness: {
    type: 'integer',
    minimum: 0,
    maximum: 100,
    title: 'Right brightness (%)',
  },
};

export class RgbBarSides1791797400000 implements MigrationInterface {
  name = 'RgbBarSides1791797400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "device_types"
          SET "stateSchema" = jsonb_set("stateSchema", '{properties}',
                                        ("stateSchema"->'properties') || $1::jsonb)
        WHERE "key" = 'rgb_bar'`,
      [JSON.stringify(NEW_PROPERTIES)],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "device_types"
          SET "stateSchema" = "stateSchema" #- '{properties,join}'
                                            #- '{properties,rightColor}'
                                            #- '{properties,rightBrightness}'
        WHERE "key" = 'rgb_bar'`,
    );
  }
}
