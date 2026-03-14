import type { BrowserAction, PlannerDecision } from "@openbrowse/contracts";
import type { PlannerInput } from "../PlannerGateway.js";
import type { DemoScenario, DemoScenarioStep } from "../ScriptedPlannerGateway.js";

function makePageModel(url: string, title: string, summary: string, visibleText: string, elements: Array<{ id: string; role: string; label: string; value?: string; isActionable: boolean }>) {
  return {
    id: `page_demo_${Date.now()}`,
    url,
    title,
    summary,
    elements,
    visibleText,
    createdAt: new Date().toISOString()
  };
}

export function createAppointmentBookingScenario(): DemoScenario {
  const steps: DemoScenarioStep[] = [
    // Step 1: Navigate to ZocDoc
    {
      decision: {
        type: "browser_action",
        reasoning: "Navigating to ZocDoc to search for dentist appointments.",
        action: {
          type: "navigate",
          value: "https://www.zocdoc.com",
          description: "Navigate to ZocDoc"
        }
      },
      simulatedPageModel: makePageModel(
        "https://www.zocdoc.com",
        "ZocDoc | Find a Doctor Near You",
        "ZocDoc homepage with search fields for doctors, specialties, and locations.",
        "ZocDoc\nFind the right doctor, right now\nSearch by condition, procedure, or doctor\nLocation\nInsurance\nFind doctors",
        [
          { id: "el_1", role: "textbox", label: "Search by condition, procedure, or doctor", value: "", isActionable: true },
          { id: "el_2", role: "textbox", label: "Location", value: "", isActionable: true },
          { id: "el_3", role: "combobox", label: "Insurance", value: "", isActionable: true },
          { id: "el_4", role: "button", label: "Find doctors", isActionable: true }
        ]
      )
    },

    // Step 2: Search for dentist
    {
      decision: {
        type: "browser_action",
        reasoning: "Typing 'dentist general cleaning' in the search field.",
        action: {
          type: "type",
          targetId: "el_1",
          value: "Dentist - General Cleaning",
          description: "Search for dentist for general cleaning"
        }
      }
    },

    // Step 3: Click search
    {
      decision: {
        type: "browser_action",
        reasoning: "Clicking the search button to find available dentists.",
        action: {
          type: "click",
          targetId: "el_4",
          description: "Click Find doctors"
        }
      },
      simulatedPageModel: makePageModel(
        "https://www.zocdoc.com/search?specialty=dentist&procedure=cleaning",
        "Dentists Near You – ZocDoc",
        "Search results showing available dentists with appointment slots this week.",
        "26 dentists available this week\n\n★ 4.9 Dr. Sarah Chen, DDS\nGeneral Dentist · 15 years experience\nNext available: Tomorrow, 9:00 AM\nAlso available: Wed 2:00 PM, Thu 10:00 AM\n123 Main Street, Suite 200\n\n★ 4.7 Dr. Michael Park, DDS\nGeneral Dentist · 8 years experience\nNext available: Wednesday, 11:00 AM\nAlso available: Thu 3:00 PM, Fri 9:00 AM\n456 Oak Avenue, Suite 100\n\n★ 4.8 Dr. Lisa Rodriguez, DDS\nGeneral Dentist · 12 years experience\nNext available: Thursday, 1:00 PM\nAlso available: Fri 11:00 AM\n789 Elm Street",
        [
          { id: "el_10", role: "link", label: "Dr. Sarah Chen - Tomorrow 9:00 AM", isActionable: true },
          { id: "el_11", role: "link", label: "Dr. Sarah Chen - Wed 2:00 PM", isActionable: true },
          { id: "el_12", role: "link", label: "Dr. Michael Park - Wed 11:00 AM", isActionable: true },
          { id: "el_13", role: "link", label: "Dr. Michael Park - Thu 3:00 PM", isActionable: true },
          { id: "el_14", role: "link", label: "Dr. Lisa Rodriguez - Thu 1:00 PM", isActionable: true },
          { id: "el_15", role: "button", label: "Show more results", isActionable: true }
        ]
      )
    },

    // Step 4: Ask clarification for preferred provider and time
    {
      decision: (input: PlannerInput): PlannerDecision<BrowserAction> => ({
        type: "clarification_request",
        reasoning: "Found multiple dentists with available slots. Need user preference for provider and time.",
        clarificationRequest: {
          id: `clarify_${input.run.id}_provider`,
          runId: input.run.id,
          question: "I found 3 dentists with availability this week. Which provider and time slot do you prefer?",
          contextSummary: "Available options:\n• Dr. Sarah Chen (★ 4.9) — Tomorrow 9 AM, Wed 2 PM, Thu 10 AM\n• Dr. Michael Park (★ 4.7) — Wed 11 AM, Thu 3 PM, Fri 9 AM\n• Dr. Lisa Rodriguez (★ 4.8) — Thu 1 PM, Fri 11 AM",
          options: [
            { id: "opt_1", label: "Dr. Chen – Tomorrow 9 AM", summary: "Top-rated, earliest available" },
            { id: "opt_2", label: "Dr. Chen – Wed 2 PM", summary: "Top-rated, afternoon slot" },
            { id: "opt_3", label: "Dr. Park – Wed 11 AM", summary: "Wednesday morning" },
            { id: "opt_4", label: "Dr. Rodriguez – Thu 1 PM", summary: "Thursday afternoon" }
          ],
          createdAt: new Date().toISOString()
        }
      })
    },

    // Step 5 (after clarification): Click selected slot
    {
      decision: (input: PlannerInput): PlannerDecision<BrowserAction> => {
        const answer = input.run.checkpoint.notes.at(-1) ?? "Dr. Chen – Tomorrow 9 AM";
        // Map answer to the right element
        let targetId = "el_10";
        if (answer.includes("Wed 2")) targetId = "el_11";
        else if (answer.includes("Park")) targetId = "el_12";
        else if (answer.includes("Rodriguez")) targetId = "el_14";

        return {
          type: "browser_action",
          reasoning: `User selected "${answer}". Clicking the corresponding appointment slot.`,
          action: {
            type: "click",
            targetId,
            description: `Select appointment: ${answer}`
          }
        };
      },
      simulatedPageModel: makePageModel(
        "https://www.zocdoc.com/book/confirm?doctor=sarah-chen&slot=tomorrow-9am",
        "Confirm Your Appointment – ZocDoc",
        "Appointment confirmation page with booking details and confirm button.",
        "Confirm Your Appointment\n\nDr. Sarah Chen, DDS\nGeneral Cleaning\nDate: Tomorrow, 9:00 AM\nLocation: 123 Main Street, Suite 200\n\nPatient Information\nName: [Your Name]\nPhone: [Your Phone]\n\nInsurance: [Select insurance]\n\n[Confirm Booking]\n[Cancel]",
        [
          { id: "el_20", role: "textbox", label: "Name", value: "", isActionable: true },
          { id: "el_21", role: "textbox", label: "Phone", value: "", isActionable: true },
          { id: "el_22", role: "combobox", label: "Insurance", value: "", isActionable: true },
          { id: "el_23", role: "button", label: "Confirm Booking", isActionable: true },
          { id: "el_24", role: "button", label: "Cancel", isActionable: true }
        ]
      )
    },

    // Step 6: Request approval before confirming the booking (irreversible)
    {
      decision: (input: PlannerInput): PlannerDecision<BrowserAction> => ({
        type: "approval_request",
        reasoning: "About to confirm a dentist appointment booking. This is an irreversible action that requires user approval.",
        action: {
          type: "click",
          targetId: "el_23",
          description: "Confirm the appointment booking"
        },
        approvalRequest: {
          id: `approval_${input.run.id}_booking`,
          runId: input.run.id,
          question: "Shall I confirm the booking for Dr. Sarah Chen (General Cleaning) tomorrow at 9:00 AM?",
          irreversibleActionSummary: "This will book a dentist appointment at 123 Main Street. The booking may be difficult to cancel on short notice.",
          createdAt: new Date().toISOString()
        }
      })
    },

    // Step 7: Complete with booking confirmation
    {
      decision: {
        type: "task_complete",
        reasoning: "Appointment has been confirmed after user approval.",
        completionSummary: "Successfully booked a dentist appointment:\n\n• **Doctor:** Dr. Sarah Chen, DDS (★ 4.9)\n• **Service:** General Cleaning\n• **Date:** Tomorrow, 9:00 AM\n• **Location:** 123 Main Street, Suite 200\n\nThe appointment is confirmed. You should receive a confirmation email from ZocDoc shortly."
      }
    }
  ];

  return {
    id: "appointment-booking",
    label: "Appointment Booking Demo",
    steps
  };
}
