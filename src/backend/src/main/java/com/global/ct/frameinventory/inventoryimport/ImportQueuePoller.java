package com.global.ct.frameinventory.inventoryimport;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.MessageSystemAttributeName;

@Component
@Profile("local-import")
@ConditionalOnProperty(name = "inventory.import.dispatch.enabled", havingValue = "true")
class ImportQueuePoller {
    private static final Logger LOGGER = LoggerFactory.getLogger(ImportQueuePoller.class);
    private final SqsClient sqs;
    private final ImportDispatch dispatch;
    private final String queueUrl;
    private final String dlqUrl;

    ImportQueuePoller(SqsClient sqs, ImportDispatch dispatch,
                      @Value("${inventory.import.dispatch.queue-url}") String queueUrl,
                      @Value("${inventory.import.dispatch.dlq-url}") String dlqUrl) {
        this.sqs = sqs;
        this.dispatch = dispatch;
        this.queueUrl = queueUrl;
        this.dlqUrl = dlqUrl;
    }

    @Scheduled(fixedDelay = 250)
    void pollSource() {
        poll(queueUrl, false);
    }

    @Scheduled(fixedDelay = 2_000)
    void pollDeadLetters() {
        poll(dlqUrl, true);
    }

    private void poll(String url, boolean deadLetter) {
        try {
            var received = sqs.receiveMessage(request -> request.queueUrl(url).waitTimeSeconds(1)
                .maxNumberOfMessages(1)
                .messageSystemAttributeNames(MessageSystemAttributeName.APPROXIMATE_RECEIVE_COUNT));
            for (var message : received.messages()) {
                handle(url, message, deadLetter);
            }
        } catch (RuntimeException failure) {
            LOGGER.warn("Import queue operation failed (deadLetter={}, error={})",
                deadLetter, failure.getClass().getSimpleName());
        }
    }

    private void handle(String url, Message message, boolean deadLetter) {
        try {
            if (deadLetter) {
                dispatch.reconcileDeadLetter(message.body());
            } else {
                dispatch.dispatch(message.body());
            }
        } catch (S3ImportNotifications.InvalidNotification invalid) {
            LOGGER.warn("Invalid S3 import notification (deadLetter={})", deadLetter);
            if (!deadLetter) {
                defer(url, message, false);
                return;
            }
            // An invalid envelope cannot safely identify a job.
        } catch (ImportTemporalDispatch.DispatchStillReconciling pending) {
            defer(url, message, deadLetter);
            return;
        } catch (RuntimeException failure) {
            LOGGER.warn("Import message will retry (deadLetter={}, error={})",
                deadLetter, failure.getClass().getSimpleName());
            defer(url, message, deadLetter);
            return;
        }
        sqs.deleteMessage(request -> request.queueUrl(url).receiptHandle(message.receiptHandle()));
    }

    private void defer(String url, Message message, boolean deadLetter) {
        int receives = Integer.parseInt(message.attributes()
            .getOrDefault(MessageSystemAttributeName.APPROXIMATE_RECEIVE_COUNT, "1"));
        int seconds = deadLetter ? 60 : Math.min(60, 5 << Math.min(4, Math.max(0, receives - 1)));
        sqs.changeMessageVisibility(request -> request.queueUrl(url)
            .receiptHandle(message.receiptHandle()).visibilityTimeout(seconds));
    }
}
