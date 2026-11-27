-- 예약 작업을 1분마다로 바꾸기 (지수·환율은 매분, 전 종목은 함수가 5분마다만 받음)
select cron.alter_job(jobid, schedule := '* * * * *') from cron.job where jobname = 'kis-market';
select jobname, schedule from cron.job where jobname = 'kis-market';
