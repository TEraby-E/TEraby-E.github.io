// 参考《算法题讲义》第 3 章（第 101-105、109-115 页）。
struct ListNode {
    int data;
    ListNode* next;
};

// 带头结点，空表写作 ListNode head{0, nullptr}。
// 插入后继：先接好后半段，再修改前驱的 next。
ListNode* insertAfter(ListNode* pre, int value) {
    if (!pre) return nullptr;
    ListNode* node = new ListNode{value, pre->next};
    pre->next = node;
    return node;
}

// 删除后继：跳过目标结点，再释放由 new 分配的结点。
bool eraseAfter(ListNode* pre) {
    if (!pre || !pre->next) return false;
    ListNode* node = pre->next;
    pre->next = node->next;
    delete node;
    return true;
}

// 从空表建表。头插得到逆序，尾插保持输入顺序。
void buildByHead(ListNode& head, const int a[], int n) {
    for (int i = 0; i < n; ++i) insertAfter(&head, a[i]);
}

void buildByTail(ListNode& head, const int a[], int n) {
    ListNode* tail = &head;
    for (int i = 0; i < n; ++i) tail = insertAfter(tail, a[i]);
}

void traverse(const ListNode& head, void (*visit)(int)) {
    for (const ListNode* p = head.next; p; p = p->next) visit(p->data);
}

// 快指针每次走两步。先确认它和它的后继均存在。
bool hasCycle(const ListNode& head) {
    const ListNode* slow = head.next;
    const ListNode* fast = head.next;
    while (fast && fast->next) {
        slow = slow->next;
        fast = fast->next->next;
        if (slow == fast) return true;
    }
    return false;
}

// 无环链表的中点；偶数长度时返回后一个中点。
const ListNode* middleNode(const ListNode& head) {
    const ListNode* slow = head.next;
    const ListNode* fast = head.next;
    while (fast && fast->next) {
        slow = slow->next;
        fast = fast->next->next;
    }
    return slow;
}

// 头插逆置：改指针前，先记住尚未处理的后继。
void reverseList(ListNode& head) {
    ListNode* p = head.next;
    head.next = nullptr;
    while (p) {
        ListNode* next = p->next;
        p->next = head.next;
        head.next = p;
        p = next;
    }
}

void clearList(ListNode& head) {
    while (head.next) eraseAfter(&head);
}
