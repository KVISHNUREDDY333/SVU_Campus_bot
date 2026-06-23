# SVU Campus Bot Models Package
from .user import User, Token, TokenData, RegisterRequest, ForgotPasswordRequest, VerifyOTPRequest, VerifyOnlyOTPRequest, ProfileUpdateRequest
from .chat import ChatRequest, FeedbackRequest
from .faq import FAQRequest, FAQModel, FAQResponse, SuggestedFAQModel, SuggestedFAQResponse
from .location import LocationModel, LocationResponse, LocationUpdate
from .notification import NotificationModel, NotificationResponse, NotificationList
from .trending import TrendingQueryModel, TrendingQueryResponse, TrendingQueryUpdate
from .academic import StudyMaterialModel, ExamDateModel, ResumeAnalysisRequest, ResumeGenerationRequest, StudyBuddyChatRequest, ZenRequest
