import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MqttUsers1791267136906 implements MigrationInterface {
  name = 'MqttUsers1791267136906';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "mqtt_users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "username" character varying NOT NULL, "passwordHash" character varying NOT NULL, "kind" character varying NOT NULL, "deviceId" uuid, "superuser" boolean NOT NULL DEFAULT false, "acl" jsonb NOT NULL DEFAULT '[]', "enabled" boolean NOT NULL DEFAULT true, "lastAuthAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_e24f1896ccbd4faf5b8cb9e30ad" UNIQUE ("username"), CONSTRAINT "REL_9acc6ff2f2c3444c53fb807bad" UNIQUE ("deviceId"), CONSTRAINT "CHK_e07e03911f07c56c17af4a0a7a" CHECK ("kind" IN ('device', 'client')), CONSTRAINT "PK_f01f716cc758a463a3820dabb35" PRIMARY KEY ("id"))`,
    );
    // Move each device's broker password hash into its mqtt_users row before dropping it.
    await queryRunner.query(
      `INSERT INTO "mqtt_users" ("username", "passwordHash", "kind", "deviceId") SELECT "hardwareId", "secretHash", 'device', "id" FROM "devices"`,
    );
    await queryRunner.query(`ALTER TABLE "devices" DROP COLUMN "secretHash"`);
    await queryRunner.query(
      `ALTER TABLE "mqtt_users" ADD CONSTRAINT "FK_9acc6ff2f2c3444c53fb807bad9" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mqtt_users" DROP CONSTRAINT "FK_9acc6ff2f2c3444c53fb807bad9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "devices" ADD "secretHash" character varying`,
    );
    await queryRunner.query(
      `UPDATE "devices" d SET "secretHash" = u."passwordHash" FROM "mqtt_users" u WHERE u."deviceId" = d."id"`,
    );
    await queryRunner.query(
      `UPDATE "devices" SET "secretHash" = '' WHERE "secretHash" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "devices" ALTER COLUMN "secretHash" SET NOT NULL`,
    );
    await queryRunner.query(`DROP TABLE "mqtt_users"`);
  }
}
