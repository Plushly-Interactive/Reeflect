package com.coralclock.reeflect

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

// The periodic poll: every 15 minutes (WorkManager's floor) the tracker reads what the system recorded.
class TrackerWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        UsageTracker.poll(applicationContext)
        return Result.success()
    }

    companion object {
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<TrackerWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("usage-poll", ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
