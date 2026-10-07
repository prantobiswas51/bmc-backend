import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DeviceIdPrefix1791298148498 implements MigrationInterface {
  name = 'DeviceIdPrefix1791298148498';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "device_types" ADD "idPrefix" character varying`,
    );
    // Hardware IDs become {prefix}_00001, {prefix}_00002, …
    await queryRunner.query(
      `UPDATE "device_types" SET "idPrefix" = v.prefix
         FROM (VALUES ('fanled', 'BM_FAN'), ('rgb_bar', 'BM_MBL'), ('camera', 'BM_CAM')) AS v(key, prefix)
        WHERE "device_types"."key" = v.key`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "device_types" DROP COLUMN "idPrefix"`,
    );
  }
}
