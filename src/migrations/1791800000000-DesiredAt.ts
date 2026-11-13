import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When the current desired state was sent. Devices compare it with the time of their own
 * local changes, so whichever was sent last wins (see DevicesService.onReported).
 */
export class DesiredAt1791800000000 implements MigrationInterface {
  name = 'DesiredAt1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "devices" ADD "desiredAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "devices" DROP COLUMN "desiredAt"`);
  }
}
